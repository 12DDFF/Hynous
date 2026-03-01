"""Artemis S3 data pipeline.

Downloads, processes, and deletes Hyperliquid historical data from
the Artemis S3 bucket, one day at a time to fit within VPS disk budget.

S3 bucket: s3://artemis-hyperliquid-data/raw/
Access: Requester-pays (~$0.09/GB transfer)
Datasets:
  - node_fills/     — every trade (sz, price, buyer, seller, liquidation flag)
  - perp_balances/  — all positions snapshot (all addresses, full state)
"""

import gzip
import json
import logging
import shutil
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
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
    min_position_usd: float = 50_000  # wallet-level filter (seeding, profiling)

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
) -> list[DayResult]:
    """Process a range of dates from Artemis S3.

    Processes one day at a time: download -> extract -> delete -> next day.

    Args:
        start_date: First date to process (inclusive).
        end_date: Last date to process (inclusive).
        data_layer_db: data-layer Database for writing historical tables.
        satellite_store: SatelliteStore for writing feature snapshots.
        config: Pipeline configuration.

    Returns:
        List of DayResult summaries.
    """
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
            )
            results.append(result)
            log.info(
                "Day %s: %d addresses, %d liqs, %d snapshots (%.0fs)",
                date_str, result.addresses_discovered,
                result.liquidation_events,
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
) -> DayResult:
    """Process one day of Artemis data.

    Steps:
      1. Download Perp Balances -> extract addresses + OI
      2. Delete Perp Balances raw file
      3. Download Node Fills -> extract trades + liquidations
      4. Delete Node Fills raw file
      5. Fetch candles + funding from HL API
      6. Reconstruct feature snapshots
      7. Label snapshots

    Args:
        date_str: Date in YYYY-MM-DD format.
        data_layer_db: data-layer Database.
        satellite_store: SatelliteStore.
        config: Pipeline configuration.

    Returns:
        DayResult summary.
    """
    t0 = time.time()
    temp_dir = Path(config.temp_dir) / date_str
    temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Phase 1: Perp Balances
        addresses = 0
        perp_file = _download_s3(
            config.s3_bucket,
            f"{config.s3_prefix}perp_balances/{date_str}/",
            temp_dir / "perp_balances",
        )
        if perp_file:
            addresses = _process_perp_balances(
                perp_file, data_layer_db, date_str, config,
            )
            _safe_delete(perp_file)

        # Phase 2: Node Fills
        liqs = 0
        trades = 0
        profiles = 0
        fills_file = _download_s3(
            config.s3_bucket,
            f"{config.s3_prefix}node_fills/{date_str}/",
            temp_dir / "node_fills",
        )
        if fills_file:
            liqs, trades, profiles = _process_node_fills(
                fills_file, data_layer_db, date_str, config,
            )
            _safe_delete(fills_file)

        # Phase 3: Candles + Funding + Feature Reconstruction
        from satellite.artemis.reconstruct import reconstruct_day
        snapshots, labels = reconstruct_day(
            date_str=date_str,
            data_layer_db=data_layer_db,
            satellite_store=satellite_store,
            config=config,
        )

    finally:
        # Always clean up temp directory
        shutil.rmtree(temp_dir, ignore_errors=True)

    return DayResult(
        date=date_str,
        addresses_discovered=addresses,
        liquidation_events=liqs,
        trades_processed=trades,
        profiles_computed=profiles,
        snapshots_reconstructed=snapshots,
        labels_computed=labels,
        elapsed_seconds=time.time() - t0,
    )


# ─── S3 Operations ──────────────────────────────────────────────────────────

def _download_s3(
    bucket: str, prefix: str, dest: Path,
) -> Path | None:
    """Download files from S3 (requester-pays).

    Uses boto3 with requester-pays flag.

    Args:
        bucket: S3 bucket name.
        prefix: S3 key prefix (folder).
        dest: Local destination directory.

    Returns:
        Path to downloaded file, or None if not found.
    """
    try:
        import boto3

        s3 = boto3.client("s3")
        dest.mkdir(parents=True, exist_ok=True)

        # List objects in prefix
        response = s3.list_objects_v2(
            Bucket=bucket, Prefix=prefix,
            RequestPayer="requester",
        )

        if "Contents" not in response:
            log.warning(
                "No S3 objects found at s3://%s/%s", bucket, prefix,
            )
            return None

        # Download each file
        downloaded = []
        for obj in response["Contents"]:
            key = obj["Key"]
            filename = key.split("/")[-1]
            if not filename:
                continue

            local_path = dest / filename
            log.debug(
                "Downloading s3://%s/%s -> %s", bucket, key, local_path,
            )
            s3.download_file(
                bucket, key, str(local_path),
                ExtraArgs={"RequestPayer": "requester"},
            )
            downloaded.append(local_path)

        return downloaded[0] if downloaded else None

    except Exception:
        log.exception(
            "S3 download failed for s3://%s/%s", bucket, prefix,
        )
        return None


# ─── Data Processing ────────────────────────────────────────────────────────

def _process_perp_balances(
    file_path: Path,
    db: object,
    date_str: str,
    config: ArtemisConfig,
) -> int:
    """Process Perp Balances file: extract addresses + positions + OI.

    Perp Balances contains a snapshot of ALL addresses with positions.
    This is the most complete address discovery source.

    Returns:
        Number of unique addresses discovered.
    """
    from satellite.artemis.seeder import seed_addresses
    from datetime import datetime

    significant_addresses = set()
    oi_by_coin: dict[str, float] = {}

    opener = gzip.open if str(file_path).endswith(".gz") else open
    with opener(file_path, "rt") as f:
        for line in f:
            try:
                record = json.loads(line)
                address = (
                    record.get("user") or record.get("address")
                )
                if not address:
                    continue

                # Extract position info
                positions = record.get("assetPositions", [])
                has_significant = False

                for pos in positions:
                    item = pos.get("position", {})
                    coin = item.get("coin", "")
                    size_usd = abs(
                        float(item.get("positionValue", 0)),
                    )

                    # OI: ALL positions count (market-wide aggregate)
                    if coin and size_usd > 0:
                        oi_by_coin[coin] = (
                            oi_by_coin.get(coin, 0) + size_usd
                        )

                    # Seeding: only wallets with meaningful positions
                    if size_usd >= config.min_position_usd:
                        has_significant = True

                if has_significant:
                    significant_addresses.add(address)

            except (json.JSONDecodeError, ValueError, KeyError):
                continue

    # Seed only significant addresses into data-layer
    seed_addresses(db, list(significant_addresses), date_str)

    # Write OI history
    dt = datetime.strptime(date_str, "%Y-%m-%d")
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
        "Perp Balances %s: %d significant addresses (>=$%.0fK), %d coins with OI",
        date_str, len(significant_addresses),
        config.min_position_usd / 1000, len(oi_by_coin),
    )
    return len(significant_addresses)


def _process_node_fills(
    file_path: Path,
    db: object,
    date_str: str,
    config: ArtemisConfig,
) -> tuple[int, int, int]:
    """Process Node Fills file: extract trades + liquidations.

    Node Fills contains every trade with buyer/seller addresses and
    a liquidation flag.

    Returns:
        (liquidation_events, trades_processed, profiles_computed)
    """
    from satellite.artemis.profiler import batch_profile

    liqs = 0
    trades = 0
    liq_batch = []
    trade_records: dict[str, list] = {}
    volume_by_coin_bucket: dict[tuple[str, int], float] = {}

    opener = gzip.open if str(file_path).endswith(".gz") else open
    with opener(file_path, "rt") as f:
        for line in f:
            try:
                record = json.loads(line)
                trades += 1

                coin = record.get("coin", "")
                px = float(record.get("px", 0))
                sz = float(record.get("sz", 0))
                size_usd = px * sz
                is_liq = (
                    record.get("liquidation", False)
                    or record.get("liq", False)
                )
                timestamp = record.get("time", 0)
                if isinstance(timestamp, str):
                    from datetime import datetime
                    timestamp = datetime.fromisoformat(
                        timestamp,
                    ).timestamp()

                buyer = record.get("buyer") or (
                    record.get("users", [None, None])[0]
                )
                seller = record.get("seller") or (
                    record.get("users", [None, None])[1]
                )

                # Record liquidation events
                if is_liq and size_usd >= 100:
                    liqs += 1
                    side = record.get("side", "")
                    normalized_side = (
                        "long" if side in ("B", "buy") else "short"
                    )
                    liq_batch.append((
                        coin, timestamp, normalized_side,
                        size_usd, px, buyer or seller,
                    ))

                # Aggregate volume per 5-minute bucket
                if coin and size_usd > 0 and timestamp > 0:
                    bucket = int(timestamp // 300) * 300
                    key = (coin, bucket)
                    volume_by_coin_bucket[key] = (
                        volume_by_coin_bucket.get(key, 0) + size_usd
                    )

                # Collect trades per address for profiling
                for addr in [buyer, seller]:
                    if addr:
                        if addr not in trade_records:
                            trade_records[addr] = []
                        trade_records[addr].append({
                            "coin": coin,
                            "side": (
                                "buy" if addr == buyer else "sell"
                            ),
                            "px": px,
                            "sz": sz,
                            "size_usd": size_usd,
                            "time": timestamp,
                        })

            except (json.JSONDecodeError, ValueError, KeyError):
                continue

    # Batch insert liquidation events + volume history
    with db.write_lock:
        db.conn.executemany(
            "INSERT OR IGNORE INTO liquidation_events "
            "(coin, occurred_at, side, size_usd, price, address) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            liq_batch,
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
        db.conn.commit()

    # Filter trade_records: only profile wallets with significant volume
    significant_traders = {
        addr: trades
        for addr, trades in trade_records.items()
        if sum(t["size_usd"] for t in trades) >= config.min_position_usd
    }

    # Batch wallet profiling (significant wallets only)
    profiles = batch_profile(db, significant_traders, date_str)

    log.info(
        "Node Fills %s: %d trades, %d liqs, %d profiles",
        date_str, trades, liqs, profiles,
    )
    return liqs, trades, profiles


def _safe_delete(path: Path) -> None:
    """Delete a file or directory, logging but never raising."""
    try:
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()
        log.debug("Deleted %s", path)
    except Exception:
        log.warning("Failed to delete %s", path, exc_info=True)
