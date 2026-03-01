"""Asynchronous outcome labeler for satellite snapshots.

Computes ground-truth labels by looking forward at actual price action.
Labels answer: "If we entered LONG or SHORT at this snapshot's time,
what was the best achievable ROE in the next 15m/30m/1h/4h?"

Labels are fee-adjusted (net ROE) because the model must learn
which entries are profitable AFTER fees, not just gross.

This module also generates simulated exit training data from market
candles, producing ~30x more exit model rows than real trades alone.
"""

import logging
import time
from dataclasses import dataclass

log = logging.getLogger(__name__)


# ─── Constants ───────────────────────────────────────────────────────────────

# Fee structure (in decimal, not percent)
# ML speed enables maker open (limit orders placed before move completes)
FEE_OPEN_MAKER = 0.00020      # 0.020% (2 bps)
FEE_CLOSE_TAKER = 0.00050     # 0.050% (5 bps)
FEE_ROUND_TRIP = FEE_OPEN_MAKER + FEE_CLOSE_TAKER  # 0.070% (7 bps)

DEFAULT_LEVERAGE = 20

# Label windows in seconds
LABEL_WINDOWS = {
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "4h": 14400,
}

# Clip extreme ROE values to prevent outliers from dominating training
ROE_CLIP_MIN = -20.0  # %
ROE_CLIP_MAX = 20.0   # %

# Minimum age (seconds) before a snapshot can be labeled.
# Must be >= longest label window (4h = 14400s).
MIN_LABEL_AGE = 14400


# ─── Label Result ────────────────────────────────────────────────────────────

@dataclass
class LabelResult:
    """Outcome labels for a single snapshot."""

    snapshot_id: str

    # Gross ROE (before fees) — all windows
    best_long_roe_15m_gross: float | None
    best_long_roe_30m_gross: float | None
    best_long_roe_1h_gross: float | None
    best_long_roe_4h_gross: float | None

    best_short_roe_15m_gross: float | None
    best_short_roe_30m_gross: float | None
    best_short_roe_1h_gross: float | None
    best_short_roe_4h_gross: float | None

    # Net ROE (after fees) — primary training targets
    best_long_roe_30m_net: float | None
    best_short_roe_30m_net: float | None

    # Maximum adverse excursion (worst drawdown before best exit)
    worst_long_mae_30m: float | None
    worst_short_mae_30m: float | None

    # Binary labels (for evaluation metrics, not training)
    # Thresholds applied: is the net ROE > 0? > 1%? > 2%? > 3%? > 5%?
    label_long_net0: int | None   # net ROE > 0
    label_long_net1: int | None   # net ROE > 1%
    label_long_net2: int | None   # net ROE > 2%
    label_long_net3: int | None   # net ROE > 3%
    label_long_net5: int | None   # net ROE > 5%

    label_short_net0: int | None
    label_short_net1: int | None
    label_short_net2: int | None
    label_short_net3: int | None
    label_short_net5: int | None

    labeled_at: float
    label_version: int


# ─── Core Labeling ───────────────────────────────────────────────────────────

def compute_labels(
    snapshot_id: str,
    entry_time: float,
    coin: str,
    candles: list[dict],
    leverage: int = DEFAULT_LEVERAGE,
) -> LabelResult | None:
    """Compute outcome labels for a snapshot using forward-looking candles.

    Args:
        snapshot_id: UUID of the snapshot to label.
        entry_time: Unix timestamp of the snapshot (entry moment).
        coin: Coin symbol (for logging only).
        candles: List of OHLCV candle dicts, sorted by time ascending.
            Required keys: open_time (epoch), open, high, low, close, volume.
            Must cover at least 4h of data after entry_time.
        leverage: Position leverage (default 20x).

    Returns:
        LabelResult with all labels computed, or None if insufficient data.
    """
    # Filter to strictly future candles only (open_time > entry_time)
    future_candles = [c for c in candles if c["open_time"] > entry_time]

    if len(future_candles) < 3:
        log.debug(
            "Insufficient candles for labeling %s at %s", coin, entry_time,
        )
        return None

    # Entry price = close of the candle at entry time (most reproducible)
    entry_candle = _find_entry_candle(candles, entry_time)
    if entry_candle is None:
        log.debug("No entry candle found for %s at %s", coin, entry_time)
        return None

    entry_price = entry_candle["close"]
    if entry_price <= 0:
        return None

    # Compute gross ROE for each window
    result_data = {}
    for window_name, window_seconds in LABEL_WINDOWS.items():
        window_candles = [
            c for c in future_candles
            if c["open_time"] <= entry_time + window_seconds
        ]

        if not window_candles:
            result_data[f"best_long_roe_{window_name}_gross"] = None
            result_data[f"best_short_roe_{window_name}_gross"] = None
            continue

        # Best long ROE: highest high in window
        best_high = max(c["high"] for c in window_candles)
        long_roe_gross = (
            (best_high - entry_price) / entry_price * leverage * 100
        )

        # Best short ROE: lowest low in window
        best_low = min(c["low"] for c in window_candles)
        short_roe_gross = (
            (1 - best_low / entry_price) * leverage * 100
        )

        # Clip to [-20, +20]
        result_data[f"best_long_roe_{window_name}_gross"] = _clip_roe(
            long_roe_gross,
        )
        result_data[f"best_short_roe_{window_name}_gross"] = _clip_roe(
            short_roe_gross,
        )

    # Net ROE (30m window — primary training target)
    fee_roe = FEE_ROUND_TRIP * leverage * 100  # in ROE% terms

    long_30m_gross = result_data.get("best_long_roe_30m_gross")
    short_30m_gross = result_data.get("best_short_roe_30m_gross")

    long_30m_net = (
        _clip_roe(long_30m_gross - fee_roe)
        if long_30m_gross is not None else None
    )
    short_30m_net = (
        _clip_roe(short_30m_gross - fee_roe)
        if short_30m_gross is not None else None
    )

    # MAE (30m window — worst drawdown before best exit)
    mae_long, mae_short = _compute_mae(
        future_candles, entry_price, entry_time, 1800, leverage,
    )

    # Binary labels at various thresholds (for evaluation, not training)
    binary_long = _binary_labels(long_30m_net)
    binary_short = _binary_labels(short_30m_net)

    return LabelResult(
        snapshot_id=snapshot_id,
        best_long_roe_15m_gross=result_data.get("best_long_roe_15m_gross"),
        best_long_roe_30m_gross=result_data.get("best_long_roe_30m_gross"),
        best_long_roe_1h_gross=result_data.get("best_long_roe_1h_gross"),
        best_long_roe_4h_gross=result_data.get("best_long_roe_4h_gross"),
        best_short_roe_15m_gross=result_data.get("best_short_roe_15m_gross"),
        best_short_roe_30m_gross=result_data.get("best_short_roe_30m_gross"),
        best_short_roe_1h_gross=result_data.get("best_short_roe_1h_gross"),
        best_short_roe_4h_gross=result_data.get("best_short_roe_4h_gross"),
        best_long_roe_30m_net=long_30m_net,
        best_short_roe_30m_net=short_30m_net,
        worst_long_mae_30m=mae_long,
        worst_short_mae_30m=mae_short,
        label_long_net0=binary_long.get("net0"),
        label_long_net1=binary_long.get("net1"),
        label_long_net2=binary_long.get("net2"),
        label_long_net3=binary_long.get("net3"),
        label_long_net5=binary_long.get("net5"),
        label_short_net0=binary_short.get("net0"),
        label_short_net1=binary_short.get("net1"),
        label_short_net2=binary_short.get("net2"),
        label_short_net3=binary_short.get("net3"),
        label_short_net5=binary_short.get("net5"),
        labeled_at=time.time(),
        label_version=1,
    )


# ─── Helper Functions ────────────────────────────────────────────────────────

def _find_entry_candle(
    candles: list[dict], entry_time: float,
) -> dict | None:
    """Find the candle whose interval contains entry_time.

    Returns the candle where open_time <= entry_time < open_time + interval.
    If no exact match, returns the most recent candle before entry_time.
    """
    best = None
    for c in candles:
        if c["open_time"] <= entry_time:
            best = c
        else:
            break
    return best


def _clip_roe(roe: float) -> float:
    """Clip ROE to [-20, +20] range."""
    return max(ROE_CLIP_MIN, min(ROE_CLIP_MAX, roe))


def _compute_mae(
    future_candles: list[dict],
    entry_price: float,
    entry_time: float,
    window_seconds: int,
    leverage: int,
) -> tuple[float | None, float | None]:
    """Compute maximum adverse excursion for long and short within window.

    MAE = worst drawdown experienced before reaching the best exit.
    Negative value (e.g., -5.2% = 5.2% drawdown).
    """
    window_candles = [
        c for c in future_candles
        if c["open_time"] <= entry_time + window_seconds
    ]

    if not window_candles:
        return None, None

    # Long MAE: worst low relative to entry
    worst_low = min(c["low"] for c in window_candles)
    mae_long = (worst_low - entry_price) / entry_price * leverage * 100

    # Short MAE: worst high relative to entry
    worst_high = max(c["high"] for c in window_candles)
    mae_short = (1 - worst_high / entry_price) * leverage * 100

    return _clip_roe(mae_long), _clip_roe(mae_short)


def _binary_labels(net_roe: float | None) -> dict[str, int | None]:
    """Convert continuous net ROE to binary labels at multiple thresholds."""
    if net_roe is None:
        return {
            "net0": None, "net1": None, "net2": None,
            "net3": None, "net5": None,
        }

    return {
        "net0": 1 if net_roe > 0 else 0,
        "net1": 1 if net_roe > 1.0 else 0,
        "net2": 1 if net_roe > 2.0 else 0,
        "net3": 1 if net_roe > 3.0 else 0,
        "net5": 1 if net_roe > 5.0 else 0,
    }


# ─── Label Storage ───────────────────────────────────────────────────────────

def save_labels(store: object, result: LabelResult) -> None:
    """Write label result to the snapshot_labels table.

    Args:
        store: SatelliteStore instance.
        result: LabelResult from compute_labels().
    """
    with store.write_lock:
        store.conn.execute(
            """
            INSERT OR REPLACE INTO snapshot_labels (
                label_id, snapshot_id,
                best_long_roe_15m_gross, best_long_roe_30m_gross,
                best_long_roe_1h_gross, best_long_roe_4h_gross,
                best_short_roe_15m_gross, best_short_roe_30m_gross,
                best_short_roe_1h_gross, best_short_roe_4h_gross,
                best_long_roe_30m_net, best_short_roe_30m_net,
                worst_long_mae_30m, worst_short_mae_30m,
                labeled_at, label_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"lbl-{result.snapshot_id}",
                result.snapshot_id,
                result.best_long_roe_15m_gross,
                result.best_long_roe_30m_gross,
                result.best_long_roe_1h_gross,
                result.best_long_roe_4h_gross,
                result.best_short_roe_15m_gross,
                result.best_short_roe_30m_gross,
                result.best_short_roe_1h_gross,
                result.best_short_roe_4h_gross,
                result.best_long_roe_30m_net,
                result.best_short_roe_30m_net,
                result.worst_long_mae_30m,
                result.worst_short_mae_30m,
                result.labeled_at,
                result.label_version,
            ),
        )
        store.conn.commit()


# ─── Label Runner ────────────────────────────────────────────────────────────

def run_labeler(
    store: object,
    candle_fetcher: callable,
    coins: list[str],
    leverage: int = DEFAULT_LEVERAGE,
) -> int:
    """Run the labeler on all unlabeled snapshots old enough to label.

    This is designed to run periodically (e.g., every hour via daemon or cron).

    Args:
        store: SatelliteStore instance.
        candle_fetcher: Callable(coin, start_time, end_time) -> list[dict].
            Must return 5m candles covering the requested range.
        coins: List of coins to label.
        leverage: Default leverage for ROE computation.

    Returns:
        Number of snapshots labeled in this run.
    """
    labeled = 0

    for coin in coins:
        unlabeled = store.get_unlabeled_snapshots(coin)

        for snap in unlabeled:
            try:
                # Fetch candles covering snapshot time through +4h
                start = snap["created_at"] - 300  # include entry candle
                end = snap["created_at"] + LABEL_WINDOWS["4h"] + 300

                candles = candle_fetcher(coin, start, end)
                if not candles:
                    continue

                result = compute_labels(
                    snapshot_id=snap["snapshot_id"],
                    entry_time=snap["created_at"],
                    coin=coin,
                    candles=candles,
                    leverage=leverage,
                )

                if result:
                    save_labels(store, result)
                    labeled += 1

            except Exception:
                log.exception(
                    "Labeling failed for snapshot %s", snap["snapshot_id"],
                )

    if labeled:
        log.info("Labeled %d snapshots", labeled)

    return labeled


# ─── Simulated Exit Training Data ────────────────────────────────────────────

@dataclass
class SimulatedExit:
    """One row of simulated exit training data.

    Pretends a trade was opened at entry_time and asks:
    "At this checkpoint, should I hold or exit?"
    """
    snapshot_id: str
    coin: str
    side: str           # "long" or "short"
    entry_price: float
    checkpoint_time: float
    checkpoint_price: float
    current_roe: float       # ROE at this checkpoint
    remaining_roe: float     # best ROE achievable AFTER this checkpoint
    should_hold: int         # 1 if remaining_roe > current_roe, else 0


def generate_simulated_exits(
    snapshot_id: str,
    entry_time: float,
    coin: str,
    candles: list[dict],
    leverage: int = DEFAULT_LEVERAGE,
    checkpoint_interval: int = 300,  # every 5 minutes
    hold_window: int = 1800,         # 30 minutes total
) -> list[SimulatedExit]:
    """Generate simulated exit training data from candles.

    For each checkpoint within the hold window:
      - Compute current ROE (what we have now)
      - Compute remaining ROE (best achievable from here)
      - Label: should_hold = 1 if remaining > current

    This produces ~6 exit training rows per snapshot (30min / 5min = 6).
    With 288 snapshots/day x 3 coins x 6 checkpoints = 5,184 rows/day.

    Args:
        snapshot_id: Source snapshot UUID.
        entry_time: When the simulated trade opens.
        coin: Coin symbol.
        candles: Forward-looking candles (5m resolution, sorted ascending).
        leverage: Position leverage.
        checkpoint_interval: Seconds between exit decision points.
        hold_window: Total time window for exit simulation.

    Returns:
        List of SimulatedExit rows for both long and short.
    """
    future_candles = [c for c in candles if c["open_time"] > entry_time]
    if len(future_candles) < 2:
        return []

    entry_candle = _find_entry_candle(candles, entry_time)
    if entry_candle is None:
        return []
    entry_price = entry_candle["close"]
    if entry_price <= 0:
        return []

    fee_roe = FEE_ROUND_TRIP * leverage * 100
    results = []

    for side in ("long", "short"):
        for checkpoint_offset in range(
            checkpoint_interval, hold_window + 1, checkpoint_interval,
        ):
            checkpoint_time = entry_time + checkpoint_offset

            # Find candle at checkpoint
            checkpoint_candle = _find_entry_candle(
                future_candles, checkpoint_time,
            )
            if checkpoint_candle is None:
                continue

            checkpoint_price = checkpoint_candle["close"]

            # Current ROE at checkpoint (fee-adjusted — net ROE)
            if side == "long":
                current_roe = (
                    (checkpoint_price - entry_price)
                    / entry_price * leverage * 100 - fee_roe
                )
            else:
                current_roe = (
                    (1 - checkpoint_price / entry_price)
                    * leverage * 100 - fee_roe
                )

            # Best remaining ROE (from checkpoint to end of window)
            remaining_candles = [
                c for c in future_candles
                if checkpoint_time < c["open_time"] <= entry_time + hold_window
            ]

            if remaining_candles:
                if side == "long":
                    best_remaining_high = max(
                        c["high"] for c in remaining_candles
                    )
                    remaining_roe = (
                        (best_remaining_high - entry_price)
                        / entry_price * leverage * 100 - fee_roe
                    )
                else:
                    best_remaining_low = min(
                        c["low"] for c in remaining_candles
                    )
                    remaining_roe = (
                        (1 - best_remaining_low / entry_price)
                        * leverage * 100 - fee_roe
                    )
            else:
                remaining_roe = current_roe  # no future data = stay flat

            should_hold = 1 if remaining_roe > current_roe else 0

            results.append(SimulatedExit(
                snapshot_id=snapshot_id,
                coin=coin,
                side=side,
                entry_price=entry_price,
                checkpoint_time=checkpoint_time,
                checkpoint_price=checkpoint_price,
                current_roe=_clip_roe(current_roe),
                remaining_roe=_clip_roe(remaining_roe),
                should_hold=should_hold,
            ))

    return results
