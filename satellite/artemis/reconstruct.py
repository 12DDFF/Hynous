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

                # Filter candles to window around this snapshot
                # (compute_features uses last few candles relative to 'now')
                snap_ms = snapshot_time * 1000
                c5m = [
                    c for c in candles_by_coin[coin]
                    if c["t"] <= snap_ms
                ]
                c1m = [
                    c for c in candles_1m_by_coin[coin]
                    if c["t"] <= snap_ms
                ]

                result = compute_features(
                    coin=coin,
                    snapshot=synthetic_snapshot,
                    data_layer_db=data_layer_db,
                    heatmap_engine=None,
                    order_flow_engine=None,
                    config=None,
                    timestamp=snapshot_time,
                    candles_5m=c5m,
                    candles_1m=c1m,
                )

                # CVD: compute_features needs OrderFlowEngine (None in backfill).
                # Override from trade_flow_history table instead.
                _enrich_cvd(result, coin, snapshot_time, data_layer_db)

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

    # Re-label previous day's unlabeled snapshots.
    # When day N was processed, snapshots after ~20:00 UTC couldn't get 4h labels
    # because day N+1's candles didn't exist yet. Now that we've built day N+1's
    # candles (this day), we can fill those gaps.
    prev_labels = _relabel_previous_day(
        dt, coins, data_layer_db, satellite_store,
    )
    labels_computed += prev_labels

    log.info(
        "Reconstructed %s: %d snapshots, %d labels (%d from prev day relabel)",
        date_str, snapshots_created, labels_computed, prev_labels,
    )
    return snapshots_created, labels_computed


def _relabel_previous_day(
    current_dt: datetime,
    coins: list[str],
    data_layer_db: object,
    satellite_store: object,
) -> int:
    """Re-label unlabeled snapshots from the previous day.

    When day N was reconstructed, late-day snapshots (after ~20:00 UTC)
    couldn't get 4h forward labels because day N+1's candles didn't exist.
    Now that day N+1 has been processed, we load candles spanning both days
    and fill in the missing labels.

    Args:
        current_dt: The current day being processed (day N+1).
        coins: List of coin symbols.
        data_layer_db: Data-layer DB with candles_history.
        satellite_store: SatelliteStore for reading/writing.

    Returns:
        Number of labels computed.
    """
    from satellite.labeler import compute_labels, save_labels

    prev_dt = current_dt - timedelta(days=1)
    prev_start = prev_dt.timestamp()
    prev_end = current_dt.timestamp()

    labels_added = 0

    for coin in coins:
        # Find unlabeled snapshots from previous day
        unlabeled = satellite_store.conn.execute(
            """
            SELECT s.snapshot_id, s.created_at, s.coin
            FROM snapshots s
            LEFT JOIN snapshot_labels sl ON s.snapshot_id = sl.snapshot_id
            WHERE s.coin = ? AND s.created_at >= ? AND s.created_at < ?
              AND sl.snapshot_id IS NULL
            ORDER BY s.created_at ASC
            """,
            (coin, prev_start, prev_end),
        ).fetchall()

        if not unlabeled:
            continue

        # Load candles spanning prev day + 4h into current day
        candles = _load_candles_from_db(
            data_layer_db, coin, "5m",
            prev_start - 3600, prev_end + 14400,
        )

        if not candles:
            continue

        for row in unlabeled:
            try:
                label_result = compute_labels(
                    snapshot_id=row["snapshot_id"],
                    entry_time=row["created_at"],
                    coin=coin,
                    candles=candles,
                )
                if label_result:
                    save_labels(satellite_store, label_result)
                    labels_added += 1
            except Exception:
                log.debug(
                    "Failed relabel for %s at %s",
                    coin, row["created_at"], exc_info=True,
                )

        if labels_added:
            log.info(
                "Re-labeled %d snapshots from %s for %s",
                labels_added, prev_dt.strftime("%Y-%m-%d"), coin,
            )

    return labels_added


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

    # Price from nearest candle (HL-format keys: t=ms, c=close)
    nearest_candle = _find_nearest_candle(candles, timestamp)
    if nearest_candle:
        snap.prices[coin] = nearest_candle["c"]

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

    # Volume: NOT set here. _compute_volume_ratio reads from volume_history table.
    # Setting volume_usd from candle data would use wrong semantics (candle vol != 5m bucket vol).

    return snap


def _enrich_cvd(
    result: object,
    coin: str,
    timestamp: float,
    data_layer_db: object,
) -> None:
    """Override CVD from trade_flow_history (no OrderFlowEngine in backfill).

    compute_features() sets CVD to neutral when order_flow_engine is None.
    We fill it from the same taker-side buy/sell volumes stored by the pipeline.
    """
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
                "t": float(r["open_time"]) * 1000,  # ms, matches HL API format
                "o": float(r["open"]),
                "h": float(r["high"]),
                "l": float(r["low"]),
                "c": float(r["close"]),
                "v": float(r["volume"]),
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
            # Keep as ms (HL-format) — matches _load_candles_from_db output
            t_ms = float(t) if isinstance(t, (int, float)) else float(t)
            candles.append({
                "t": t_ms,
                "o": float(c["o"]),
                "h": float(c["h"]),
                "l": float(c["l"]),
                "c": float(c["c"]),
                "v": float(c["v"]),
            })

        return sorted(candles, key=lambda x: x["t"])

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
    """Find the candle whose open time is closest to but <= timestamp.

    Candles use HL-format keys: t is in milliseconds.
    """
    best = None
    ts_ms = timestamp * 1000
    for c in candles:
        if c["t"] <= ts_ms:
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
