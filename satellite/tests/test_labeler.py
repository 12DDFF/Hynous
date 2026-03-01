"""Unit tests for satellite labeler with synthetic candle data.

8 test cases covering: long win, short win, no move, fee wipeout,
MAE computation, clipping, multiple windows, simulated exits.
Plus label storage via SatelliteStore.
"""

import time

import pytest

from satellite.labeler import (
    DEFAULT_LEVERAGE,
    FEE_ROUND_TRIP,
    compute_labels,
    generate_simulated_exits,
    save_labels,
    _binary_labels,
    _clip_roe,
    _compute_mae,
)
from satellite.store import SatelliteStore


def _make_candles(
    entry_time: float,
    prices: list[tuple[float, float, float, float]],
) -> list[dict]:
    """Create synthetic 5m candles from (open, high, low, close) tuples.

    Each tuple is one 5m candle. First candle starts at entry_time - 300
    (so it contains the entry time).
    """
    candles = []
    for i, (o, h, l, c) in enumerate(prices):
        candles.append({
            "open_time": entry_time - 300 + i * 300,
            "open": o,
            "high": h,
            "low": l,
            "close": c,
            "volume": 1000000,
        })
    return candles


def _make_store() -> SatelliteStore:
    """Create an in-memory satellite store."""
    store = SatelliteStore(":memory:")
    store.connect()
    return store


# ─── compute_labels tests ────────────────────────────────────────────────────


class TestComputeLabels:

    def test_long_win_clear(self):
        """BTC goes from 100K to 101K in 30m = 20% gross ROE at 20x."""
        t = 1709500000.0
        candles = _make_candles(t, [
            (100000, 100000, 100000, 100000),  # t-300: history
            (100000, 100000, 100000, 100000),  # t: entry candle (close=100K)
            (100000, 100200, 100000, 100200),  # future: +0.2%
            (100200, 100500, 100100, 100500),  # +0.5%
            (100500, 100800, 100400, 100800),  # +0.8%
            (100800, 101000, 100700, 101000),  # +1.0% = 20% ROE gross
            (101000, 101000, 100900, 100900),  # consolidation
            (100900, 100900, 100800, 100800),  # slight pullback
        ])
        result = compute_labels("snap-1", t, "BTC", candles)
        assert result is not None
        # Gross: (101000 - 100000) / 100000 * 20 * 100 = 20.0%
        assert result.best_long_roe_30m_gross == pytest.approx(20.0, abs=0.1)
        # Net: 20.0 - (0.0007 * 20 * 100) = 20.0 - 1.4 = 18.6%
        fee_roe = FEE_ROUND_TRIP * DEFAULT_LEVERAGE * 100
        assert result.best_long_roe_30m_net == pytest.approx(
            20.0 - fee_roe, abs=0.1,
        )
        # Binary: clearly profitable
        assert result.label_long_net5 == 1

    def test_short_win_clear(self):
        """BTC drops from 100K to 99K in 30m = 20% gross ROE short."""
        t = 1709500000.0
        candles = _make_candles(t, [
            (100000, 100000, 100000, 100000),  # t-300: history
            (100000, 100000, 100000, 100000),  # t: entry candle (close=100K)
            (100000, 100000, 99800, 99800),    # future: dropping
            (99800, 99800, 99500, 99500),
            (99500, 99500, 99200, 99200),
            (99200, 99200, 99000, 99000),      # -1.0% = 20% ROE short
            (99000, 99100, 99000, 99100),
            (99100, 99100, 99000, 99050),
        ])
        result = compute_labels("snap-2", t, "BTC", candles)
        assert result is not None
        # Short ROE: (1 - 99000/100000) * 20 * 100 = 20.0%
        assert result.best_short_roe_30m_gross == pytest.approx(20.0, abs=0.1)

    def test_no_move_fee_wipeout(self):
        """Price stays flat — any trade is net negative after fees."""
        t = 1709500000.0
        candles = _make_candles(t, [
            (100000, 100000, 100000, 100000),
            (100000, 100010, 99990, 100000),
            (100000, 100010, 99990, 100000),
            (100000, 100010, 99990, 100000),
            (100000, 100010, 99990, 100000),
            (100000, 100010, 99990, 100000),
            (100000, 100010, 99990, 100000),
        ])
        result = compute_labels("snap-3", t, "BTC", candles)
        assert result is not None
        # Gross ROE is tiny (~0.2%), net is negative
        assert result.best_long_roe_30m_net < 0
        assert result.best_short_roe_30m_net < 0
        assert result.label_long_net0 == 0
        assert result.label_short_net0 == 0

    def test_mae_computation(self):
        """MAE captures worst drawdown in the window."""
        t = 1709500000.0
        candles = _make_candles(t, [
            (100000, 100000, 100000, 100000),  # t-300: history
            (100000, 100000, 100000, 100000),  # t: entry candle (close=100K)
            (100000, 100000, 98000, 99000),    # future: 2% dip (long MAE)
            (99000, 101000, 99000, 101000),     # recovery + new high
            (101000, 101000, 100500, 100800),
            (100800, 100800, 100500, 100600),
            (100600, 100600, 100400, 100500),
            (100500, 100500, 100300, 100400),
        ])
        result = compute_labels("snap-4", t, "BTC", candles)
        assert result is not None
        # Long MAE: (98000 - 100000) / 100000 * 20 * 100 = -40% (clipped)
        assert result.worst_long_mae_30m == -20.0  # clipped to -20

    def test_multiple_windows(self):
        """All 4 windows produce labels when candles are available."""
        t = 1709500000.0
        # Create enough candles to cover 4h (48 x 5m candles + 1 entry)
        prices = [(100000, 100100, 99900, 100050)] * 50
        prices[0] = (100000, 100000, 100000, 100000)  # entry candle
        candles = _make_candles(t, prices)
        result = compute_labels("snap-5", t, "BTC", candles)
        assert result is not None
        assert result.best_long_roe_15m_gross is not None
        assert result.best_long_roe_30m_gross is not None
        assert result.best_long_roe_1h_gross is not None
        assert result.best_long_roe_4h_gross is not None


# ─── Helper function tests ───────────────────────────────────────────────────


class TestHelpers:

    def test_roe_clipping(self):
        """Extreme ROE values are clipped to [-20, +20]."""
        assert _clip_roe(25.0) == 20.0
        assert _clip_roe(-25.0) == -20.0
        assert _clip_roe(5.0) == 5.0

    def test_binary_labels_thresholds(self):
        """Binary labels at 0/1/2/3/5% thresholds."""
        labels = _binary_labels(3.5)
        assert labels["net0"] == 1
        assert labels["net1"] == 1
        assert labels["net2"] == 1
        assert labels["net3"] == 1
        assert labels["net5"] == 0

    def test_binary_labels_none(self):
        """None input produces all-None labels."""
        labels = _binary_labels(None)
        for v in labels.values():
            assert v is None

    def test_insufficient_candles_returns_none(self):
        """Less than 3 future candles = can't label."""
        t = 1709500000.0
        candles = _make_candles(t, [
            (100000, 100000, 100000, 100000),
            (100000, 100100, 99900, 100050),
        ])
        result = compute_labels("snap-6", t, "BTC", candles)
        assert result is None


# ─── Simulated exit tests ────────────────────────────────────────────────────


class TestSimulatedExits:

    def test_generates_both_sides(self):
        """Simulated exit data has entries for both long and short."""
        t = 1709500000.0
        candles = _make_candles(t, [
            (100000, 100000, 100000, 100000),
            (100000, 100100, 100000, 100100),   # rising
            (100100, 100200, 100050, 100200),
            (100200, 100500, 100150, 100500),   # peak
            (100500, 100500, 100200, 100300),
            (100300, 100350, 100100, 100200),
            (100200, 100250, 100100, 100150),
        ])
        exits = generate_simulated_exits("snap-7", t, "BTC", candles)
        assert len(exits) > 0
        sides = {ex.side for ex in exits}
        assert sides == {"long", "short"}

    def test_valid_labels(self):
        """All exits have valid should_hold values."""
        t = 1709500000.0
        candles = _make_candles(t, [
            (100000, 100000, 100000, 100000),
            (100000, 100100, 100000, 100100),
            (100100, 100200, 100050, 100200),
            (100200, 100500, 100150, 100500),
            (100500, 100500, 100200, 100300),
            (100300, 100350, 100100, 100200),
            (100200, 100250, 100100, 100150),
        ])
        exits = generate_simulated_exits("snap-8", t, "BTC", candles)
        for ex in exits:
            assert ex.should_hold in (0, 1)
            assert ex.side in ("long", "short")

    def test_checkpoint_count(self):
        """With 30m window and 300s interval, expect 6 checkpoints per side."""
        t = 1709500000.0
        candles = _make_candles(t, [
            (100000, 100000, 100000, 100000),
            (100000, 100100, 99900, 100050),
            (100050, 100100, 99900, 100050),
            (100050, 100100, 99900, 100050),
            (100050, 100100, 99900, 100050),
            (100050, 100100, 99900, 100050),
            (100050, 100100, 99900, 100050),
        ])
        exits = generate_simulated_exits("snap-9", t, "BTC", candles)
        long_exits = [e for e in exits if e.side == "long"]
        short_exits = [e for e in exits if e.side == "short"]
        assert len(long_exits) == 6
        assert len(short_exits) == 6


# ─── Label storage tests ─────────────────────────────────────────────────────


class TestLabelStorage:

    def test_save_and_read_labels(self):
        """Labels can be saved and read back from the store."""
        store = _make_store()
        t = 1709500000.0

        # Must have a snapshot first (foreign key)
        from satellite.features import FEATURE_NAMES, NEUTRAL_VALUES, FeatureResult
        snap = FeatureResult(
            snapshot_id="snap-store-1",
            created_at=t,
            coin="BTC",
            features={n: NEUTRAL_VALUES[n] for n in FEATURE_NAMES},
            availability={
                "liq_magnet_avail": 0, "oi_7d_avail": 0,
                "liq_cascade_avail": 0, "funding_zscore_avail": 0,
                "cvd_avail": 0, "volume_avail": 0, "realized_vol_avail": 0,
            },
            raw_data=None,
            schema_version=1,
        )
        store.save_snapshot(snap)

        # Compute and save labels
        candles = _make_candles(t, [
            (100000, 100000, 100000, 100000),  # t-300: history
            (100000, 100000, 100000, 100000),  # t: entry candle (close=100K)
            (100000, 100200, 100000, 100200),  # future
            (100200, 100500, 100100, 100500),
            (100500, 100800, 100400, 100800),
            (100800, 101000, 100700, 101000),  # +1% = 20% ROE
            (101000, 101000, 100900, 100900),
            (100900, 100900, 100800, 100800),
        ])
        label = compute_labels("snap-store-1", t, "BTC", candles)
        assert label is not None
        save_labels(store, label)

        # Read back
        row = store.conn.execute(
            "SELECT * FROM snapshot_labels WHERE snapshot_id = ?",
            ("snap-store-1",),
        ).fetchone()
        assert row is not None
        assert row["label_id"] == "lbl-snap-store-1"
        assert row["best_long_roe_30m_gross"] == pytest.approx(20.0, abs=0.1)

    def test_unlabeled_excludes_labeled(self):
        """get_unlabeled_snapshots() excludes already-labeled snapshots."""
        store = _make_store()
        old_ts = time.time() - 20000  # old enough to label

        from satellite.features import FEATURE_NAMES, NEUTRAL_VALUES, FeatureResult
        snap = FeatureResult(
            snapshot_id="snap-excl-1",
            created_at=old_ts,
            coin="BTC",
            features={n: NEUTRAL_VALUES[n] for n in FEATURE_NAMES},
            availability={
                "liq_magnet_avail": 0, "oi_7d_avail": 0,
                "liq_cascade_avail": 0, "funding_zscore_avail": 0,
                "cvd_avail": 0, "volume_avail": 0, "realized_vol_avail": 0,
            },
            raw_data=None,
            schema_version=1,
        )
        store.save_snapshot(snap)

        # Before labeling: appears in unlabeled
        unlabeled = store.get_unlabeled_snapshots("BTC")
        assert len(unlabeled) == 1

        # Label it
        candles = _make_candles(old_ts, [
            (100000, 100000, 100000, 100000),  # history
            (100000, 100000, 100000, 100000),  # entry candle
            (100000, 100200, 100000, 100200),  # future
            (100200, 100500, 100100, 100500),
            (100500, 100800, 100400, 100800),
            (100800, 101000, 100700, 101000),
            (101000, 101000, 100900, 100900),
            (100900, 100900, 100800, 100800),
        ])
        label = compute_labels("snap-excl-1", old_ts, "BTC", candles)
        save_labels(store, label)

        # After labeling: excluded
        unlabeled = store.get_unlabeled_snapshots("BTC")
        assert len(unlabeled) == 0
