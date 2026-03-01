"""Tests for liquidation heatmap engine."""

import time

from hynous_data.core.db import Database
from hynous_data.core.config import HeatmapConfig
from hynous_data.engine.liq_heatmap import LiqHeatmapEngine


def _make_db() -> Database:
    """Create an in-memory database with schema."""
    db = Database(":memory:")
    db.connect()
    db.init_schema()
    return db


def _insert_position(db, address, coin, side, size_usd, liq_px):
    db.conn.execute(
        """
        INSERT OR REPLACE INTO positions
        (address, coin, side, size, size_usd, entry_px, mark_px,
         leverage, margin_used, liq_px, unrealized_pnl, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (address, coin, side, size_usd / 100000, size_usd, 100000, 100000,
         10, size_usd / 10, liq_px, 0, time.time()),
    )
    db.conn.commit()


def test_empty_heatmap():
    db = _make_db()
    engine = LiqHeatmapEngine(db, HeatmapConfig())
    assert engine.get_heatmap("BTC") is None


def test_compute_heatmap():
    db = _make_db()
    config = HeatmapConfig(bucket_count=10, range_pct=10)
    engine = LiqHeatmapEngine(db, config)

    # Insert positions with liq prices
    _insert_position(db, "0xaaa", "BTC", "long", 500000, 95000)   # long liq below
    _insert_position(db, "0xbbb", "BTC", "short", 300000, 105000)  # short liq above
    _insert_position(db, "0xccc", "BTC", "long", 200000, 92000)   # long liq below

    # Manually compute (bypass threading)
    result = engine._compute_coin_heatmap("BTC", 100000)
    assert result is not None
    assert result["coin"] == "BTC"
    assert result["mid_price"] == 100000
    assert len(result["buckets"]) == 10

    # Check summary
    s = result["summary"]
    assert s["total_long_liq_usd"] == 700000  # 500k + 200k
    assert s["total_short_liq_usd"] == 300000
    assert s["total_positions"] == 3


def test_out_of_range_positions():
    db = _make_db()
    config = HeatmapConfig(bucket_count=10, range_pct=5)
    engine = LiqHeatmapEngine(db, config)

    # Position with liq price way outside range (>5%)
    _insert_position(db, "0xaaa", "BTC", "long", 500000, 50000)

    result = engine._compute_coin_heatmap("BTC", 100000)
    # Out of range — no buckets populated
    assert result is not None
    assert result["summary"]["total_long_liq_usd"] == 0
