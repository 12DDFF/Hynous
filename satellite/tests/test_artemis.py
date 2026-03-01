"""Tests for the Artemis pipeline: profiler, layer2, reconstruct helpers."""

import sqlite3
import threading
import time

import pytest

from satellite.artemis.profiler import compute_profile
from satellite.artemis.layer2 import collect_co_occurrence, save_co_occurrences
from satellite.artemis.reconstruct import (
    _SyntheticSnapshot,
    _build_synthetic_snapshot,
    _enrich_historical_features,
    _find_nearest_candle,
    _find_nearest_record,
)
from satellite.artemis.pipeline import ArtemisConfig, DayResult
from satellite.store import SatelliteStore


# ─── Fixtures ────────────────────────────────────────────────────────────────


def _make_trades(
    n_pairs: int = 20, base_px: float = 100000, spread: float = 50,
) -> list[dict]:
    """Create n_pairs of buy/sell trades (all winners)."""
    trades = []
    for i in range(n_pairs):
        trades.append({
            "coin": "BTC",
            "side": "buy",
            "px": base_px + i * 10,
            "sz": 0.1,
            "size_usd": 10000,
            "time": i * 3600,
        })
        trades.append({
            "coin": "BTC",
            "side": "sell",
            "px": base_px + i * 10 + spread,
            "sz": 0.1,
            "size_usd": 10000,
            "time": i * 3600 + 1800,
        })
    return trades


def _make_candles(
    n: int = 20, start_time: float = 1000, interval: int = 300,
    base_price: float = 100000,
) -> list[dict]:
    """Create synthetic 5m candles."""
    candles = []
    for i in range(n):
        price = base_price + i * 10
        candles.append({
            "open_time": start_time + i * interval,
            "open": price - 5,
            "high": price + 20,
            "low": price - 20,
            "close": price,
            "volume": 100.0,
        })
    return candles


# ─── Profiler Tests ──────────────────────────────────────────────────────────


class TestProfiler:

    def test_all_winners(self):
        """Profile with all winning trades has 100% win rate."""
        trades = _make_trades(n_pairs=20, spread=50)
        profile = compute_profile("0xtest", trades)
        assert profile is not None
        assert profile["win_rate"] == 1.0
        assert profile["trade_count"] == 20

    def test_mixed_results(self):
        """Profile with mixed wins/losses computes correctly."""
        trades = []
        # 3 winning trades
        for i in range(3):
            trades.append({
                "coin": "BTC", "side": "buy",
                "px": 100000, "sz": 0.1, "size_usd": 10000,
                "time": i * 7200,
            })
            trades.append({
                "coin": "BTC", "side": "sell",
                "px": 100500, "sz": 0.1, "size_usd": 10000,
                "time": i * 7200 + 3600,
            })
        # 2 losing trades
        for i in range(2):
            trades.append({
                "coin": "BTC", "side": "buy",
                "px": 100000, "sz": 0.1, "size_usd": 10000,
                "time": (3 + i) * 7200,
            })
            trades.append({
                "coin": "BTC", "side": "sell",
                "px": 99500, "sz": 0.1, "size_usd": 10000,
                "time": (3 + i) * 7200 + 3600,
            })

        profile = compute_profile("0xmixed", trades)
        assert profile is not None
        assert profile["trade_count"] == 5
        assert profile["win_rate"] == 0.6

    def test_insufficient_trades(self):
        """Too few matched trades returns None."""
        trades = [
            {"coin": "BTC", "side": "buy", "px": 100000,
             "sz": 0.1, "size_usd": 10000, "time": 0},
            {"coin": "BTC", "side": "sell", "px": 100050,
             "sz": 0.1, "size_usd": 10000, "time": 100},
        ]
        profile = compute_profile("0xfew", trades)
        assert profile is None  # < 5 matched trades

    def test_style_classification_scalper(self):
        """Short hold time = scalper."""
        trades = _make_trades(n_pairs=10, spread=10)
        # Override times for very short holds (30 minutes)
        for i in range(0, len(trades), 2):
            trades[i]["time"] = i * 600
            trades[i + 1]["time"] = i * 600 + 1800  # 30 min hold
        profile = compute_profile("0xscalp", trades)
        assert profile is not None
        assert profile["style"] == "scalper"

    def test_profit_factor(self):
        """Profit factor is gross_profit / gross_loss."""
        trades = _make_trades(n_pairs=10, spread=50)
        profile = compute_profile("0xpf", trades)
        assert profile is not None
        assert profile["profit_factor"] == 999.0  # all wins, no losses

    def test_max_drawdown(self):
        """Max drawdown computed from cumulative PnL."""
        trades = []
        # Win, then 3 losses, then win
        prices_buy = [100000, 100000, 100000, 100000, 100000]
        prices_sell = [100100, 99800, 99700, 99900, 100200]
        for i in range(5):
            trades.append({
                "coin": "BTC", "side": "buy", "px": prices_buy[i],
                "sz": 0.1, "size_usd": 10000, "time": i * 7200,
            })
            trades.append({
                "coin": "BTC", "side": "sell", "px": prices_sell[i],
                "sz": 0.1, "size_usd": 10000, "time": i * 7200 + 3600,
            })
        profile = compute_profile("0xdd", trades)
        assert profile is not None
        assert profile["max_drawdown"] > 0

    def test_fifo_ordering(self):
        """FIFO matches first buy with first sell."""
        trades = [
            {"coin": "BTC", "side": "buy", "px": 100000,
             "sz": 0.1, "size_usd": 10000, "time": 0},
            {"coin": "BTC", "side": "buy", "px": 101000,
             "sz": 0.1, "size_usd": 10000, "time": 100},
            {"coin": "BTC", "side": "sell", "px": 100500,
             "sz": 0.1, "size_usd": 10000, "time": 200},
            {"coin": "BTC", "side": "sell", "px": 101500,
             "sz": 0.1, "size_usd": 10000, "time": 300},
            # Need 3 more matched pairs for minimum of 5
            {"coin": "BTC", "side": "buy", "px": 100000,
             "sz": 0.1, "size_usd": 10000, "time": 400},
            {"coin": "BTC", "side": "sell", "px": 100100,
             "sz": 0.1, "size_usd": 10000, "time": 500},
            {"coin": "BTC", "side": "buy", "px": 100000,
             "sz": 0.1, "size_usd": 10000, "time": 600},
            {"coin": "BTC", "side": "sell", "px": 100100,
             "sz": 0.1, "size_usd": 10000, "time": 700},
            {"coin": "BTC", "side": "buy", "px": 100000,
             "sz": 0.1, "size_usd": 10000, "time": 800},
            {"coin": "BTC", "side": "sell", "px": 100100,
             "sz": 0.1, "size_usd": 10000, "time": 900},
        ]
        profile = compute_profile("0xfifo", trades)
        assert profile is not None
        # First buy (100000) matched with first sell (100500) = win
        # Second buy (101000) matched with second sell (101500) = win
        assert profile["win_rate"] == 1.0


# ─── Layer 2 Co-occurrence Tests ─────────────────────────────────────────────


class TestCoOccurrence:

    def test_finds_co_occurrence(self):
        """Wallets entering within window are detected."""
        trades = {
            "0xa": [{"coin": "BTC", "side": "buy",
                     "time": 1000, "size_usd": 50000}],
            "0xb": [{"coin": "BTC", "side": "buy",
                     "time": 1100, "size_usd": 60000}],
            "0xc": [{"coin": "BTC", "side": "buy",
                     "time": 5000, "size_usd": 40000}],
        }
        coocs = collect_co_occurrence(trades, window_seconds=300)
        # 0xa and 0xb are within 300s, 0xc is not
        assert len(coocs) == 1
        assert set([coocs[0][0], coocs[0][1]]) == {"0xa", "0xb"}

    def test_no_self_co_occurrence(self):
        """Same address trading twice doesn't count."""
        trades = {
            "0xa": [
                {"coin": "BTC", "side": "buy",
                 "time": 1000, "size_usd": 50000},
                {"coin": "BTC", "side": "buy",
                 "time": 1100, "size_usd": 60000},
            ],
        }
        coocs = collect_co_occurrence(trades, window_seconds=300)
        assert len(coocs) == 0

    def test_different_coins_separate(self):
        """Co-occurrence is per-coin."""
        trades = {
            "0xa": [{"coin": "BTC", "side": "buy",
                     "time": 1000, "size_usd": 50000}],
            "0xb": [{"coin": "ETH", "side": "buy",
                     "time": 1050, "size_usd": 50000}],
        }
        coocs = collect_co_occurrence(trades, window_seconds=300)
        assert len(coocs) == 0  # different coins

    def test_sell_side_excluded(self):
        """Only buy (entry) side counted for co-occurrence."""
        trades = {
            "0xa": [{"coin": "BTC", "side": "sell",
                     "time": 1000, "size_usd": 50000}],
            "0xb": [{"coin": "BTC", "side": "buy",
                     "time": 1050, "size_usd": 50000}],
        }
        coocs = collect_co_occurrence(trades, window_seconds=300)
        assert len(coocs) == 0  # 0xa is selling, not entering

    def test_multiple_co_occurrences(self):
        """Multiple wallets within window produce multiple pairs."""
        trades = {
            "0xa": [{"coin": "BTC", "side": "buy",
                     "time": 1000, "size_usd": 50000}],
            "0xb": [{"coin": "BTC", "side": "buy",
                     "time": 1050, "size_usd": 50000}],
            "0xc": [{"coin": "BTC", "side": "buy",
                     "time": 1100, "size_usd": 50000}],
        }
        coocs = collect_co_occurrence(trades, window_seconds=300)
        # a-b, a-c, b-c = 3 pairs
        assert len(coocs) == 3

    def test_save_co_occurrences(self):
        """save_co_occurrences writes to satellite DB."""
        store = SatelliteStore(":memory:")
        store.connect()

        coocs = [
            ("0xa", "0xb", "BTC", 1000.0),
            ("0xa", "0xc", "BTC", 1050.0),
        ]
        count = save_co_occurrences(store, coocs)
        assert count == 2

        rows = store.conn.execute(
            "SELECT * FROM co_occurrences",
        ).fetchall()
        assert len(rows) == 2
        store.close()

    def test_save_empty_list(self):
        """Empty co-occurrence list returns 0."""
        store = SatelliteStore(":memory:")
        store.connect()
        count = save_co_occurrences(store, [])
        assert count == 0
        store.close()


# ─── Reconstruct Helper Tests ───────────────────────────────────────────────


class TestReconstructHelpers:

    def test_find_nearest_candle(self):
        """Finds candle at or before timestamp."""
        candles = _make_candles(5, start_time=1000, interval=300)
        # Exact match
        c = _find_nearest_candle(candles, 1000)
        assert c is not None
        assert c["open_time"] == 1000

        # Between candles
        c = _find_nearest_candle(candles, 1150)
        assert c is not None
        assert c["open_time"] == 1000

        # After last candle
        c = _find_nearest_candle(candles, 9999)
        assert c is not None
        assert c["open_time"] == 2200  # last candle

    def test_find_nearest_candle_before_first(self):
        """No candle before first returns None."""
        candles = _make_candles(5, start_time=1000, interval=300)
        c = _find_nearest_candle(candles, 500)
        assert c is None

    def test_find_nearest_record(self):
        """Finds record at or before timestamp."""
        records = [
            {"time": 1000, "fundingRate": 0.001},
            {"time": 2000, "fundingRate": 0.002},
            {"time": 3000, "fundingRate": 0.003},
        ]
        r = _find_nearest_record(records, 2500, "time")
        assert r is not None
        assert r["fundingRate"] == 0.002

    def test_find_nearest_record_none(self):
        """No record before timestamp returns None."""
        records = [{"time": 5000, "fundingRate": 0.001}]
        r = _find_nearest_record(records, 1000, "time")
        assert r is None

    def test_synthetic_snapshot(self):
        """SyntheticSnapshot has expected attributes."""
        snap = _SyntheticSnapshot()
        assert hasattr(snap, "prices")
        assert hasattr(snap, "funding")
        assert hasattr(snap, "oi_usd")
        assert hasattr(snap, "volume_usd")
        assert isinstance(snap.prices, dict)

    def test_enrich_price_change(self):
        """Enrichment computes price_change_5m_pct from candles."""
        candles = [
            {"open_time": 700, "open": 99990, "high": 100020,
             "low": 99970, "close": 100000, "volume": 50},
            {"open_time": 1000, "open": 100000, "high": 100050,
             "low": 99980, "close": 100020, "volume": 60},
        ]

        class FakeResult:
            features = {}
            availability = {}

        result = FakeResult()
        _enrich_historical_features(
            result, "BTC", 1000, candles, None,
        )

        assert "price_change_5m_pct" in result.features
        # (100020 - 100000) / 100000 * 100 = 0.02%
        expected = (100020 - 100000) / 100000 * 100
        assert abs(result.features["price_change_5m_pct"] - expected) < 0.01
        assert result.availability["price_change_5m_avail"] == 1


# ─── Pipeline Config Tests ───────────────────────────────────────────────────


class TestPipelineConfig:

    def test_default_config(self):
        """ArtemisConfig has sensible defaults."""
        cfg = ArtemisConfig()
        assert cfg.s3_bucket == "artemis-hyperliquid-data"
        assert cfg.s3_prefix == "raw/"
        assert cfg.temp_dir == "/tmp/artemis"
        assert cfg.batch_size == 10000
        assert cfg.min_position_usd == 50_000
        assert cfg.api_delay_seconds == 0.5
        assert "BTC" in cfg.coins

    def test_day_result_dataclass(self):
        """DayResult stores all expected fields."""
        result = DayResult(
            date="2025-08-01",
            addresses_discovered=5000,
            liquidation_events=120,
            trades_processed=50000,
            profiles_computed=200,
            snapshots_reconstructed=864,
            labels_computed=850,
            elapsed_seconds=45.3,
        )
        assert result.date == "2025-08-01"
        assert result.snapshots_reconstructed == 864


# ─── Schema Tests ────────────────────────────────────────────────────────────


class TestCoOccurrenceSchema:

    def test_table_exists(self):
        """co_occurrences table created by schema."""
        store = SatelliteStore(":memory:")
        store.connect()

        store.conn.execute(
            "INSERT INTO co_occurrences "
            "(address_a, address_b, coin, occurred_at) "
            "VALUES (?, ?, ?, ?)",
            ("0xa", "0xb", "BTC", 1000.0),
        )
        store.conn.commit()

        row = store.conn.execute(
            "SELECT * FROM co_occurrences WHERE address_a = '0xa'",
        ).fetchone()
        assert row["coin"] == "BTC"
        assert row["occurred_at"] == 1000.0
        store.close()

    def test_indexes_exist(self):
        """co_occurrences indexes are created."""
        store = SatelliteStore(":memory:")
        store.connect()

        indexes = store.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' "
            "AND tbl_name='co_occurrences'",
        ).fetchall()
        index_names = [r["name"] for r in indexes]

        assert "idx_cooc_time" in index_names
        assert "idx_cooc_addr_a" in index_names
        assert "idx_cooc_addr_b" in index_names
        store.close()
