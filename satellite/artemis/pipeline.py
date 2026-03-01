"""Artemis S3 data pipeline.

Downloads, processes, and deletes Hyperliquid historical data from
the Artemis S3 bucket, one day at a time to fit within VPS disk budget.

S3 bucket: s3://artemis-hyperliquid-data/raw/
Access: Requester-pays (~$0.09/GB transfer)
Datasets:
  - node_fills/hourly/YYYY/MM/DD/HH/  — Parquet, every trade (~25MB/hr)
  - perp_and_spot_balances/YYYY/MM/DD/ — JSONL, all positions snapshot
"""

import json
import logging
import shutil
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

log = logging.getLogger(__name__)


@dataclass
class ArtemisConfig:
    """Configuration for the Artemis pipeline."""

    s3_bucket: str = "artemis-hyperliquid-data"
    s3_prefix: str = "raw/"
    temp_dir: str = "/tmp/artemis"
    coins: list[str] = field(
        default_factory=lambda: ["BTC", "ETH", "SOL"],
    )

    # Processing
    batch_size: int = 10000        # rows per batch insert
    min_position_usd: float = 50_000  # wallet-level filter

    # Rate limiting for HL API (candle/funding fetch)
    api_delay_seconds: float = 0.5


@dataclass
class DayResult:
    """Result of processing one day of Artemis data."""

    date: str
    addresses_discovered: int
    liquidation_events: int
    trades_processed: int
    profiles_computed: int
    snapshots_reconstructed: int
    labels_computed: int
    elapsed_seconds: float


def process_date_range(
    start_date: date,
    end_date: date,
    data_layer_db: object,
    satellite_store: object,
    config: ArtemisConfig | None = None,
    skip_profiling: bool = False,
) -> list[DayResult]:
    """Process a range of dates from Artemis S3."""
    cfg = config or ArtemisConfig()
    results = []

    current = start_date
    while current <= end_date:
        date_str = current.strftime("%Y-%m-%d")
        try:
            result = process_single_day(
                date_str=date_str,
                data_layer_db=data_layer_db,
                satellite_store=satellite_store,
                config=cfg,
                skip_profiling=skip_profiling,
            )
            results.append(result)
            log.info(
                "Day %s: %d addresses, %d trades, %d snapshots (%.0fs)",
                date_str, result.addresses_discovered,
                result.trades_processed,
                result.snapshots_reconstructed,
                result.elapsed_seconds,
            )
        except Exception:
            log.exception("Failed to process day %s", date_str)

        current += timedelta(days=1)

    total_snaps = sum(r.snapshots_reconstructed for r in results)
    log.info(
        "Backfill complete: %d days, %d total snapshots",
        len(results), total_snaps,
    )
    return results


def process_single_day(
    date_str: str,
    data_layer_db: object,
    satellite_store: object,
    config: ArtemisConfig,
    skip_profiling: bool = False,
) -> DayResult:
    """Process one day of Artemis data."""
    t0 = time.time()
    temp_dir = Path(config.temp_dir) / date_str
    temp_dir.mkdir(parents=True, exist_ok=True)

    # Parse date parts for S3 paths
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    y, m, d = dt.strftime("%Y"), dt.strftime("%m"), dt.strftime("%d")

    try:
        # Phase 1: Perp & Spot Balances (JSONL)
        addresses = 0
        perp_prefix = f"{config.s3_prefix}perp_and_spot_balances/{y}/{m}/{d}/"
        perp_files = _download_s3_all(
            config.s3_bucket, perp_prefix,
            temp_dir / "perp_balances",
        )
        for pf in perp_files:
            addresses += _process_perp_balances(
                pf, data_layer_db, date_str, config,
            )
        _safe_delete(temp_dir / "perp_balances")

        # Phase 2: Node Fills (hourly Parquet)
        trades = 0
        profiles = 0
        fills_prefix = f"{config.s3_prefix}node_fills/hourly/{y}/{m}/{d}/"
        fills_files = _download_s3_all(
            config.s3_bucket, fills_prefix,
            temp_dir / "node_fills",
        )
        if fills_files:
            trades, profiles = _process_node_fills_parquet(
                fills_files, data_layer_db, date_str, config,
                skip_profiling=skip_profiling,
            )
        _safe_delete(temp_dir / "node_fills")

        # Phase 3: Candles + Funding + Feature Reconstruction
        from satellite.artemis.reconstruct import reconstruct_day
        snapshots, labels = reconstruct_day(
            date_str=date_str,
            data_layer_db=data_layer_db,
            satellite_store=satellite_store,
            config=config,
        )

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    return DayResult(
        date=date_str,
        addresses_discovered=addresses,
        liquidation_events=0,  # no liq flag in Parquet data
        trades_processed=trades,
        profiles_computed=profiles,
        snapshots_reconstructed=snapshots,
        labels_computed=labels,
        elapsed_seconds=time.time() - t0,
    )


# ─── S3 Operations ──────────────────────────────────────────────────────────

def _download_s3_all(
    bucket: str, prefix: str, dest: Path,
) -> list[Path]:
    """Download ALL files under an S3 prefix (requester-pays).

    Handles pagination and nested subdirectories.

    Returns:
        List of local file paths downloaded.
    """
    try:
        import boto3

        s3 = boto3.client("s3")
        dest.mkdir(parents=True, exist_ok=True)
        downloaded = []

        paginator = s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(
            Bucket=bucket, Prefix=prefix,
            RequestPayer="requester",
        )

        for page in pages:
            for obj in page.get("Contents", []):
                key = obj["Key"]
                filename = key.replace("/", "_")  # flatten path
                if not filename or obj["Size"] == 0:
                    continue

                local_path = dest / filename
                log.debug("Downloading s3://%s/%s", bucket, key)
                s3.download_file(
                    bucket, key, str(local_path),
                    ExtraArgs={"RequestPayer": "requester"},
                )
                downloaded.append(local_path)

        if not downloaded:
            log.info("No S3 objects at s3://%s/%s", bucket, prefix)

        return downloaded

    except Exception:
        log.exception("S3 download failed for s3://%s/%s", bucket, prefix)
        return []


# ─── Perp Balances Processing (JSONL) ──────────────────────────────────────

def _process_perp_balances(
    file_path: Path,
    db: object,
    date_str: str,
    config: ArtemisConfig,
) -> int:
    """Process Perp Balances JSONL: extract addresses + OI."""
    from satellite.artemis.seeder import seed_addresses

    significant_addresses = set()
    oi_by_coin: dict[str, float] = {}

    with open(file_path, "rt") as f:
        for line in f:
            try:
                record = json.loads(line)
                address = (
                    record.get("user") or record.get("address")
                )
                if not address:
                    continue

                positions = record.get("assetPositions", [])
                has_significant = False

                for pos in positions:
                    item = pos.get("position", {})
                    coin = item.get("coin", "")
                    size_usd = abs(
                        float(item.get("positionValue", 0)),
                    )

                    if coin and size_usd > 0:
                        oi_by_coin[coin] = (
                            oi_by_coin.get(coin, 0) + size_usd
                        )

                    if size_usd >= config.min_position_usd:
                        has_significant = True

                if has_significant:
                    significant_addresses.add(address)

            except (json.JSONDecodeError, ValueError, KeyError):
                continue

    seed_addresses(db, list(significant_addresses), date_str)

    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    epoch = dt.timestamp()
    with db.write_lock:
        for coin, oi in oi_by_coin.items():
            db.conn.execute(
                "INSERT OR IGNORE INTO oi_history "
                "(coin, recorded_at, oi_usd) VALUES (?, ?, ?)",
                (coin, epoch, oi),
            )
        db.conn.commit()

    log.info(
        "Perp Balances %s: %d addresses (>=$%.0fK), %d coins with OI",
        date_str, len(significant_addresses),
        config.min_position_usd / 1000, len(oi_by_coin),
    )
    return len(significant_addresses)


# ─── Node Fills Processing (Parquet) ────────────────────────────────────────

def _process_node_fills_parquet(
    file_paths: list[Path],
    db: object,
    date_str: str,
    config: ArtemisConfig,
    skip_profiling: bool = False,
) -> tuple[int, int]:
    """Process Node Fills Parquet files: extract trades, volume, CVD.

    Parquet columns: user, coin, px, sz, side (B/A), time, dir,
        closedPnl, crossed (taker flag), fee, tid, ...

    Each trade appears twice (buyer + seller). We use crossed=True
    (taker) for volume/CVD to avoid double-counting.

    Args:
        skip_profiling: If True, skip wallet profiling to save memory.

    Returns:
        (trades_processed, profiles_computed)
    """
    import pyarrow.parquet as pq

    from satellite.artemis.profiler import batch_profile

    total_trades = 0
    volume_by_coin_bucket: dict[tuple[str, int], float] = {}
    buy_vol_by_coin_bucket: dict[tuple[str, int], float] = {}
    sell_vol_by_coin_bucket: dict[tuple[str, int], float] = {}
    trade_records: dict[str, list] = {} if not skip_profiling else None

    # OHLCV candle builders: (coin, interval, bucket) -> {open_time, open, high, low, close, volume, first_ts}
    candle_builders_5m: dict[tuple[str, int], dict] = {}
    candle_builders_1m: dict[tuple[str, int], dict] = {}

    for fp in sorted(file_paths):
        read_cols = ["coin", "px", "sz", "side", "crossed", "time"]
        if not skip_profiling:
            read_cols.append("user")
        try:
            table = pq.read_table(str(fp), columns=read_cols)
        except Exception:
            log.warning("Failed to read Parquet: %s", fp)
            continue

        # Use PyArrow columnar access (no Pandas, much less memory)
        n_rows = table.num_rows
        col_coin = table.column("coin")
        col_px = table.column("px")
        col_sz = table.column("sz")
        col_side = table.column("side")
        col_crossed = table.column("crossed")
        col_time = table.column("time")
        col_user = table.column("user") if not skip_profiling else None

        for i in range(n_rows):
            try:
                coin = str(col_coin[i].as_py())
                px = float(col_px[i].as_py())
                sz = float(col_sz[i].as_py())
                size_usd = px * sz
                side = str(col_side[i].as_py())
                crossed = bool(col_crossed[i].as_py())

                # Convert timestamp: Two Parquet encodings exist:
                # 1. Early data (Aug 2025): raw ms stored as timestamp[ns]
                #    → .as_py() shows 1970, .value IS the ms value
                # 2. Later data (Sep+ 2025): proper datetime timestamps
                #    → .as_py() shows correct date, .timestamp() works
                ts_raw = col_time[i].as_py()
                if hasattr(ts_raw, "timestamp"):
                    timestamp = ts_raw.timestamp()
                    # Detect mis-encoded timestamps (show as 1970)
                    if timestamp < 1700000000:
                        # Raw ms stored as ns — .value is the real ms
                        timestamp = int(ts_raw.value) / 1000
                elif isinstance(ts_raw, (int, float)):
                    timestamp = float(ts_raw) / 1000
                else:
                    continue

                # Sanity check timestamp (should be 2025-2026)
                if timestamp < 1700000000 or timestamp > 1900000000:
                    continue

                total_trades += 1

                # Only count TAKER fills for volume/CVD/candles (avoid double-counting)
                if crossed and coin and size_usd > 0:
                    bucket_5m = int(timestamp // 300) * 300
                    key = (coin, bucket_5m)
                    volume_by_coin_bucket[key] = (
                        volume_by_coin_bucket.get(key, 0) + size_usd
                    )
                    if side == "B":
                        buy_vol_by_coin_bucket[key] = (
                            buy_vol_by_coin_bucket.get(key, 0) + size_usd
                        )
                    else:
                        sell_vol_by_coin_bucket[key] = (
                            sell_vol_by_coin_bucket.get(key, 0) + size_usd
                        )

                    # Build 5m and 1m OHLCV candles from taker trades
                    for builders, bucket_size in [
                        (candle_builders_5m, 300),
                        (candle_builders_1m, 60),
                    ]:
                        bucket = int(timestamp // bucket_size) * bucket_size
                        bkey = (coin, bucket)
                        if bkey not in builders:
                            builders[bkey] = {
                                "first_ts": timestamp,
                                "open": px, "high": px,
                                "low": px, "close": px,
                                "volume": sz, "last_ts": timestamp,
                            }
                        else:
                            b = builders[bkey]
                            if px > b["high"]:
                                b["high"] = px
                            if px < b["low"]:
                                b["low"] = px
                            if timestamp < b["first_ts"]:
                                b["first_ts"] = timestamp
                                b["open"] = px
                            if timestamp >= b["last_ts"]:
                                b["last_ts"] = timestamp
                                b["close"] = px
                            b["volume"] += sz

                # Collect trades per address for profiling (all fills)
                if trade_records is not None and col_user is not None:
                    user = str(col_user[i].as_py())
                    if user and size_usd >= 100:
                        if user not in trade_records:
                            trade_records[user] = []
                        trade_records[user].append({
                            "coin": coin,
                            "side": "buy" if side == "B" else "sell",
                            "px": px,
                            "sz": sz,
                            "size_usd": size_usd,
                            "time": timestamp,
                        })

            except (ValueError, TypeError, KeyError):
                continue

        # Free memory after each file
        del table

    # Write volume history + trade flow (CVD data)
    with db.write_lock:
        # Ensure tables exist
        db.conn.execute(
            "CREATE TABLE IF NOT EXISTS trade_flow_history ("
            "coin TEXT NOT NULL, recorded_at REAL NOT NULL, "
            "buy_volume_usd REAL DEFAULT 0, "
            "sell_volume_usd REAL DEFAULT 0, "
            "PRIMARY KEY (coin, recorded_at))",
        )

        vol_rows = [
            (coin, epoch, vol_usd)
            for (coin, epoch), vol_usd in volume_by_coin_bucket.items()
        ]
        if vol_rows:
            db.conn.executemany(
                "INSERT OR IGNORE INTO volume_history "
                "(coin, recorded_at, volume_usd) VALUES (?, ?, ?)",
                vol_rows,
            )

        flow_rows = []
        all_keys = (
            set(buy_vol_by_coin_bucket) | set(sell_vol_by_coin_bucket)
        )
        for key in all_keys:
            coin_k, epoch_k = key
            flow_rows.append((
                coin_k, epoch_k,
                buy_vol_by_coin_bucket.get(key, 0),
                sell_vol_by_coin_bucket.get(key, 0),
            ))
        if flow_rows:
            db.conn.executemany(
                "INSERT OR IGNORE INTO trade_flow_history "
                "(coin, recorded_at, buy_volume_usd, sell_volume_usd) "
                "VALUES (?, ?, ?, ?)",
                flow_rows,
            )

        # Write reconstructed OHLCV candles
        db.conn.execute(
            "CREATE TABLE IF NOT EXISTS candles_history ("
            "coin TEXT NOT NULL, interval TEXT NOT NULL, "
            "open_time REAL NOT NULL, open REAL NOT NULL, "
            "high REAL NOT NULL, low REAL NOT NULL, "
            "close REAL NOT NULL, volume REAL NOT NULL, "
            "PRIMARY KEY (coin, interval, open_time))",
        )
        candle_rows = []
        for (coin_k, bucket_k), b in candle_builders_5m.items():
            candle_rows.append((
                coin_k, "5m", float(bucket_k),
                b["open"], b["high"], b["low"], b["close"], b["volume"],
            ))
        for (coin_k, bucket_k), b in candle_builders_1m.items():
            candle_rows.append((
                coin_k, "1m", float(bucket_k),
                b["open"], b["high"], b["low"], b["close"], b["volume"],
            ))
        if candle_rows:
            db.conn.executemany(
                "INSERT OR IGNORE INTO candles_history "
                "(coin, interval, open_time, open, high, low, close, volume) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                candle_rows,
            )

        db.conn.commit()

    # Profile significant wallets (skipped during backfill to save memory)
    profiles = 0
    if trade_records is not None:
        significant_traders = {
            addr: trades
            for addr, trades in trade_records.items()
            if sum(t["size_usd"] for t in trades) >= config.min_position_usd
        }
        profiles = batch_profile(db, significant_traders, date_str)

    log.info(
        "Node Fills %s: %d taker trades, %d vol buckets, %d 5m candles, %d 1m candles, %d profiles",
        date_str, total_trades, len(volume_by_coin_bucket),
        len(candle_builders_5m), len(candle_builders_1m), profiles,
    )
    return total_trades, profiles


def _safe_delete(path: Path) -> None:
    """Delete a file or directory, logging but never raising."""
    try:
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()
    except Exception:
        log.warning("Failed to delete %s", path, exc_info=True)
