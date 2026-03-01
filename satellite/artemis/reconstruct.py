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

# Sentinel to distinguish "rate limited" from "no data"
_RATE_LIMITED = object()


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

    # Load ALL data from DB (candles from Artemis node_fills, funding pre-fetched)
    # No HL API calls during the main reconstruction loop.
    candles_by_coin = {}
    candles_1m_by_coin = {}
    funding_by_coin = {}
    for coin in coins:
        candles_by_coin[coin] = _load_candles_from_db(
            data_layer_db, coin, "5m",
            day_start - 3600, day_end + 14400,
        )
        candles_1m_by_coin[coin] = _load_candles_from_db(
            data_layer_db, coin, "1m",
            day_start - 3600, day_end + 300,
        )
        funding_by_coin[coin] = _load_funding_from_db(
            data_layer_db, coin,
            day_start - 30 * 86400, day_end,
        )

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
                    candles_1m=candles_1m_by_coin[coin],
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
    candles_1m: list[dict] | None = None,
) -> None:
    """Override features that need special historical computation.

    Some features can't be computed by compute_features() in historical
    mode because they need data sources not available (no live heatmap,
    no live CVD). Compute them from Artemis-derived data instead.
    """
    import math

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

    # cvd_normalized_5m from trade_flow_history (populated by _process_node_fills)
    try:
        bucket_start = int(timestamp // 300) * 300
        row = data_layer_db.conn.execute(
            "SELECT buy_volume_usd, sell_volume_usd FROM trade_flow_history "
            "WHERE coin = ? AND recorded_at = ?",
            (coin, bucket_start),
        ).fetchone()
        if row:
            buy_vol = float(row["buy_volume_usd"] or 0)
            sell_vol = float(row["sell_volume_usd"] or 0)
            total = buy_vol + sell_vol
            if total > 0:
                cvd = buy_vol - sell_vol
                result.features["cvd_normalized_5m"] = max(
                    -1.0, min(1.0, cvd / total),
                )
                result.availability["cvd_avail"] = 1
    except Exception:
        pass  # table may not exist yet, feature stays at neutral

    # realized_vol_1h from 1-minute candles
    if candles_1m:
        try:
            # Get 1m candles in the past hour
            hour_candles = [
                c for c in candles_1m
                if timestamp - 3600 <= c["open_time"] < timestamp
            ]
            if len(hour_candles) >= 10:
                # Compute log returns
                returns = []
                for i in range(1, len(hour_candles)):
                    prev_close = hour_candles[i - 1]["close"]
                    curr_close = hour_candles[i]["close"]
                    if prev_close > 0 and curr_close > 0:
                        returns.append(
                            math.log(curr_close / prev_close),
                        )
                if len(returns) >= 5:
                    mean_ret = sum(returns) / len(returns)
                    variance = sum(
                        (r - mean_ret) ** 2 for r in returns
                    ) / len(returns)
                    # Annualize: std * sqrt(periods_per_hour)
                    # But we want hourly vol, so just std * sqrt(60)
                    realized_vol = math.sqrt(variance) * math.sqrt(60) * 100
                    result.features["realized_vol_1h"] = realized_vol
                    result.availability["realized_vol_avail"] = 1
        except Exception:
            pass  # feature stays at neutral


# ─── Data Loading (from candles_history table) ───────────────────────────────

def _load_candles_from_db(
    data_layer_db: object,
    coin: str,
    interval: str,
    start: float,
    end: float,
) -> list[dict]:
    """Load OHLCV candles from candles_history table.

    Candles are built from Artemis node_fills trade data during pipeline
    processing, stored in the data-layer DB.
    """
    try:
        rows = data_layer_db.conn.execute(
            "SELECT open_time, open, high, low, close, volume "
            "FROM candles_history "
            "WHERE coin = ? AND interval = ? "
            "AND open_time >= ? AND open_time <= ? "
            "ORDER BY open_time",
            (coin, interval, start, end),
        ).fetchall()
        return [
            {
                "open_time": float(r["open_time"]),
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "volume": float(r["volume"]),
            }
            for r in rows
        ]
    except Exception:
        log.warning(
            "Failed to load %s candles for %s from DB", interval, coin,
        )
        return []


def _load_funding_from_db(
    data_layer_db: object,
    coin: str,
    start: float,
    end: float,
) -> list[dict]:
    """Load funding rates from funding_history table (pre-fetched from HL API)."""
    try:
        rows = data_layer_db.conn.execute(
            "SELECT recorded_at, rate FROM funding_history "
            "WHERE coin = ? AND recorded_at >= ? AND recorded_at <= ? "
            "ORDER BY recorded_at",
            (coin, start, end),
        ).fetchall()
        return [
            {"time": float(r["recorded_at"]), "fundingRate": float(r["rate"])}
            for r in rows
        ]
    except Exception:
        log.warning("Failed to load funding history for %s from DB", coin)
        return []


# ─── Data Fetching (HL API) ──────────────────────────────────────────────────

def _fetch_with_retry(fn, *args, max_retries: int = 5, **kwargs):
    """Call a fetch function with exponential backoff.

    Handles both empty results and rate limiting (429).
    """
    result = []
    for attempt in range(max_retries):
        result = fn(*args, **kwargs)
        if result is _RATE_LIMITED:
            # Rate limited — wait much longer
            wait = 60 * (2 ** min(attempt, 2))  # 60s, 120s, 240s
            log.warning(
                "Rate limited, waiting %ds (attempt %d/%d)...",
                wait, attempt + 1, max_retries,
            )
            time.sleep(wait)
            result = []
            continue
        if result:
            return result
        if attempt < max_retries - 1:
            wait = 10 * (2 ** attempt)  # 10s, 20s, 40s, 80s
            log.info("Retry %d/%d in %ds...", attempt + 1, max_retries, wait)
            time.sleep(wait)
    return result if result is not _RATE_LIMITED else []

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
        import requests

        resp = requests.post(
            "https://api.hyperliquid.xyz/info",
            json={
                "type": "candleSnapshot",
                "req": {
                    "coin": coin,
                    "interval": interval,
                    "startTime": int(start * 1000),
                    "endTime": int(end * 1000),
                },
            },
            timeout=30,
        )
        if resp.status_code == 429:
            log.warning("429 rate limit fetching %s candles for %s", interval, coin)
            return _RATE_LIMITED
        resp.raise_for_status()
        raw = resp.json()

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
        import requests

        resp = requests.post(
            "https://api.hyperliquid.xyz/info",
            json={
                "type": "fundingHistory",
                "coin": coin,
                "startTime": int(start * 1000),
                "endTime": int(end * 1000),
            },
            timeout=30,
        )
        if resp.status_code == 429:
            log.warning("429 rate limit fetching funding for %s", coin)
            return _RATE_LIMITED
        resp.raise_for_status()
        raw = resp.json()

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
