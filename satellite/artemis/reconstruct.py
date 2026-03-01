"""Reconstruct historical feature snapshots from Artemis data + HL candles.

All 12 structural features are reconstructable:
  - liq_magnet_direction:   <- Artemis Perp Balances (historical heatmap)
  - oi_vs_7d_avg_ratio:     <- Artemis Perp Balances (sum positions = OI)
  - liq_cascade_active:     <- Artemis Node Fills (liquidation flag)
  - liq_1h_vs_4h_avg:       <- Artemis Node Fills (liq counts per window)
  - funding_vs_30d_zscore:  <- Hyperliquid funding history API
  - hours_to_funding:       <- Clock math (trivial)
  - oi_funding_pressure:    <- OI change + funding rate
  - cvd_normalized_5m:      <- Artemis Node Fills (buyer/seller per trade)
  - price_change_5m_pct:    <- Hyperliquid 5m candles API
  - volume_vs_1h_avg_ratio: <- Artemis Node Fills (sum sizes per window)
  - realized_vol_1h:        <- Hyperliquid 1m candles API
  - sessions_overlapping:   <- Clock math (trivial)
"""

import logging
import time
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)


def reconstruct_day(
    date_str: str,
    data_layer_db: object,
    satellite_store: object,
    config: object,
) -> tuple[int, int]:
    """Reconstruct 288 feature snapshots for one day.

    Creates one snapshot every 300s (5 minutes) for each configured coin.

    Args:
        date_str: Date in YYYY-MM-DD format.
        data_layer_db: data-layer Database (has historical tables).
        satellite_store: SatelliteStore for writing snapshots.
        config: ArtemisConfig.

    Returns:
        (snapshots_created, labels_computed)
    """
    from satellite.features import compute_features
    from satellite.labeler import compute_labels, save_labels

    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(
        tzinfo=timezone.utc,
    )
    day_start = dt.timestamp()
    day_end = (dt + timedelta(days=1)).timestamp()

    coins = config.coins or ["BTC", "ETH", "SOL"]

    # Fetch candle data for the day (5m candles for price_change, labels)
    candles_by_coin = {}
    funding_by_coin = {}
    for coin in coins:
        candles_by_coin[coin] = _fetch_candles(
            coin, day_start - 3600, day_end + 14400, "5m", config,
        )
        funding_by_coin[coin] = _fetch_funding_history(
            coin, day_start - 30 * 86400, day_end,
            config, data_layer_db,
        )
        time.sleep(config.api_delay_seconds)

    snapshots_created = 0
    labels_computed = 0

    # Create a snapshot every 300s
    snapshot_time = day_start
    while snapshot_time < day_end:
        for coin in coins:
            try:
                # Build a synthetic "snapshot" object for compute_features()
                synthetic_snapshot = _build_synthetic_snapshot(
                    coin, snapshot_time, candles_by_coin[coin],
                    funding_by_coin[coin], data_layer_db,
                )

                result = compute_features(
                    coin=coin,
                    snapshot=synthetic_snapshot,
                    data_layer_db=data_layer_db,
                    heatmap_engine=None,
                    order_flow_engine=None,
                    config=None,
                    timestamp=snapshot_time,
                )

                # Override features needing special historical computation
                _enrich_historical_features(
                    result, coin, snapshot_time,
                    candles_by_coin[coin], data_layer_db,
                )

                # Mark as backfill
                result.raw_data = result.raw_data or {}
                result.raw_data["source"] = "artemis_backfill"

                # Save snapshot
                satellite_store.save_snapshot(result)
                snapshots_created += 1

                # Label immediately (we have the candle data)
                label_result = compute_labels(
                    snapshot_id=result.snapshot_id,
                    entry_time=snapshot_time,
                    coin=coin,
                    candles=candles_by_coin[coin],
                )
                if label_result:
                    save_labels(satellite_store, label_result)
                    labels_computed += 1

            except Exception:
                log.debug(
                    "Failed snapshot at %s for %s",
                    snapshot_time, coin, exc_info=True,
                )

        snapshot_time += 300  # next 5-minute mark

    log.info(
        "Reconstructed %s: %d snapshots, %d labels",
        date_str, snapshots_created, labels_computed,
    )
    return snapshots_created, labels_computed


class _SyntheticSnapshot:
    """Minimal snapshot-like object for compute_features() compatibility."""

    def __init__(self) -> None:
        self.prices: dict[str, float] = {}
        self.funding: dict[str, float] = {}
        self.oi_usd: dict[str, float] = {}
        self.volume_usd: dict[str, float] = {}


def _build_synthetic_snapshot(
    coin: str,
    timestamp: float,
    candles: list[dict],
    funding_history: list[dict],
    data_layer_db: object,
) -> _SyntheticSnapshot:
    """Build a snapshot-like object from historical data.

    Args:
        coin: Coin symbol.
        timestamp: Snapshot time.
        candles: 5m candle data.
        funding_history: Funding rate history.
        data_layer_db: For OI/volume queries.

    Returns:
        Snapshot-like object compatible with compute_features().
    """
    snap = _SyntheticSnapshot()

    # Price from nearest candle
    nearest_candle = _find_nearest_candle(candles, timestamp)
    if nearest_candle:
        snap.prices[coin] = nearest_candle["close"]

    # Funding from nearest historical record
    nearest_funding = _find_nearest_record(
        funding_history, timestamp, "time",
    )
    if nearest_funding:
        snap.funding[coin] = nearest_funding["fundingRate"]

    # OI from oi_history table (populated by Phase 1)
    try:
        oi_row = data_layer_db.conn.execute(
            "SELECT oi_usd FROM oi_history "
            "WHERE coin = ? AND recorded_at <= ? "
            "ORDER BY recorded_at DESC LIMIT 1",
            (coin, timestamp),
        ).fetchone()
        if oi_row:
            snap.oi_usd[coin] = oi_row["oi_usd"]
    except Exception:
        pass

    # Volume from candle data
    if nearest_candle:
        snap.volume_usd[coin] = (
            nearest_candle.get("volume", 0) * nearest_candle["close"]
        )

    return snap


def _enrich_historical_features(
    result: object,
    coin: str,
    timestamp: float,
    candles: list[dict],
    data_layer_db: object,
) -> None:
    """Override features that need special historical computation.

    Some features can't be computed by compute_features() in historical
    mode because they need data sources not available (no live heatmap,
    no live CVD). Compute them from Artemis-derived data instead.
    """
    # price_change_5m_pct from candles
    current_candle = _find_nearest_candle(candles, timestamp)
    prev_candle = _find_nearest_candle(candles, timestamp - 300)
    if (
        current_candle and prev_candle
        and prev_candle["close"] > 0
    ):
        pct = (
            (current_candle["close"] - prev_candle["close"])
            / prev_candle["close"] * 100
        )
        result.features["price_change_5m_pct"] = pct
        result.availability["price_change_5m_avail"] = 1


# ─── Data Fetching ───────────────────────────────────────────────────────────

def _fetch_candles(
    coin: str,
    start: float,
    end: float,
    interval: str,
    config: object,
) -> list[dict]:
    """Fetch historical candles from Hyperliquid API.

    Args:
        coin: Coin symbol.
        start: Start time (epoch).
        end: End time (epoch).
        interval: Candle interval ("1m", "5m", "1h").
        config: For rate limiting.

    Returns:
        List of candle dicts sorted by open_time.
    """
    try:
        from hyperliquid.info import Info

        info = Info(base_url="https://api.hyperliquid.xyz")
        raw = info.candles_snapshot(
            coin=coin,
            interval=interval,
            startTime=int(start * 1000),
            endTime=int(end * 1000),
        )

        candles = []
        for c in raw:
            t = c["t"]
            open_time = (
                t / 1000 if isinstance(t, (int, float)) else float(t)
            )
            candles.append({
                "open_time": open_time,
                "open": float(c["o"]),
                "high": float(c["h"]),
                "low": float(c["l"]),
                "close": float(c["c"]),
                "volume": float(c["v"]),
            })

        return sorted(candles, key=lambda x: x["open_time"])

    except Exception:
        log.exception("Failed to fetch candles for %s", coin)
        return []


def _fetch_funding_history(
    coin: str,
    start: float,
    end: float,
    config: object,
    data_layer_db: object | None = None,
) -> list[dict]:
    """Fetch historical funding rates from Hyperliquid API.

    Also writes to funding_history table so compute_features() can
    compute funding_vs_30d_zscore during historical reconstruction.

    Returns:
        List of funding rate records sorted by time.
    """
    try:
        from hyperliquid.info import Info

        info = Info(base_url="https://api.hyperliquid.xyz")
        raw = info.funding_history(
            coin=coin,
            startTime=int(start * 1000),
            endTime=int(end * 1000),
        )

        sorted_records = sorted(
            raw, key=lambda x: x.get("time", 0),
        )

        # Write to funding_history table for compute_features() to use
        if data_layer_db and sorted_records:
            rows = []
            for r in sorted_records:
                t = r.get("time", 0)
                if isinstance(t, str):
                    t = datetime.fromisoformat(t).timestamp()
                elif isinstance(t, (int, float)) and t > 1e12:
                    t = t / 1000  # convert ms to seconds
                rate = float(r.get("fundingRate", 0))
                rows.append((coin, t, rate))

            with data_layer_db.write_lock:
                data_layer_db.conn.executemany(
                    "INSERT OR IGNORE INTO funding_history "
                    "(coin, recorded_at, rate) VALUES (?, ?, ?)",
                    rows,
                )
                data_layer_db.conn.commit()

            log.debug(
                "Wrote %d funding_history rows for %s",
                len(rows), coin,
            )

        return sorted_records

    except Exception:
        log.exception(
            "Failed to fetch funding history for %s", coin,
        )
        return []


def _find_nearest_candle(
    candles: list[dict], timestamp: float,
) -> dict | None:
    """Find the candle whose open_time is closest to but <= timestamp."""
    best = None
    for c in candles:
        if c["open_time"] <= timestamp:
            best = c
        else:
            break
    return best


def _find_nearest_record(
    records: list[dict], timestamp: float, time_key: str,
) -> dict | None:
    """Find the record closest to but <= timestamp."""
    best = None
    for r in records:
        t = r.get(time_key, 0)
        if isinstance(t, str):
            t = datetime.fromisoformat(t).timestamp()
        if t <= timestamp:
            best = r
        else:
            break
    return best
