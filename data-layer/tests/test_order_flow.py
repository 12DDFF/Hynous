"""Tests for order flow engine."""

import time

from hynous_data.collectors.trade_stream import get_trade_buffer
from hynous_data.engine.order_flow import OrderFlowEngine


def _populate_buffer(coin: str, buys: int, sells: int, px: float = 100000):
    """Insert fake trades into the buffer."""
    buf = get_trade_buffer(coin)
    buf.clear()
    now_ms = int(time.time() * 1000)
    for i in range(buys):
        buf.append({"coin": coin, "side": "B", "px": px, "sz": 0.1, "time": now_ms - i * 100})
    for i in range(sells):
        buf.append({"coin": coin, "side": "A", "px": px, "sz": 0.1, "time": now_ms - i * 100})


def test_empty_flow():
    engine = OrderFlowEngine(windows=[60])
    result = engine.get_order_flow("NONEXISTENT")
    assert result["total_trades"] == 0
    assert result["windows"] == {}


def test_basic_cvd():
    _populate_buffer("BTC", buys=10, sells=5, px=100000)
    engine = OrderFlowEngine(windows=[3600])

    result = engine.get_order_flow("BTC")
    w = result["windows"]["1h"]
    assert w["buy_count"] == 10
    assert w["sell_count"] == 5
    # CVD = buy_vol - sell_vol = (10 * 100000 * 0.1) - (5 * 100000 * 0.1)
    assert w["cvd"] == 50000.0
    assert w["buy_pct"] > 60


def test_multiple_windows():
    _populate_buffer("ETH", buys=20, sells=20, px=3000)
    engine = OrderFlowEngine(windows=[60, 300, 3600])

    result = engine.get_order_flow("ETH")
    assert "1m" in result["windows"]
    assert "5m" in result["windows"]
    assert "1h" in result["windows"]

    # Equal buys and sells → CVD ≈ 0
    assert result["windows"]["1h"]["cvd"] == 0


def test_all_cvd_summary():
    _populate_buffer("SOL", buys=30, sells=10, px=200)
    engine = OrderFlowEngine()

    summary = engine.get_all_cvd_summary()
    assert "SOL" in summary
    assert summary["SOL"] > 0  # More buys than sells


def test_default_windows_include_30m():
    """v2 journal depends on cvd_30m — default windows must produce a
    `"30m"` key in the response."""
    _populate_buffer("BTC", buys=5, sells=5, px=100000)
    engine = OrderFlowEngine()
    result = engine.get_order_flow("BTC")
    assert "30m" in result["windows"]
    assert result["windows"]["30m"]["window_seconds"] == 1800


def test_large_trade_count_returns_zero_for_empty_buffer():
    """No trades in buffer → count=0 and threshold_usd=0 (no crash)."""
    buf = get_trade_buffer("NONEXISTENT_COIN")
    buf.clear()
    engine = OrderFlowEngine()
    result = engine.large_trade_count("NONEXISTENT_COIN", window_s=3600)
    assert result["count"] == 0
    assert result["threshold_usd"] == 0


def test_large_trade_count_threshold_and_count():
    """Given a mix of small + large trades, count those ≥ threshold_pct_of_window_vol
    of the window's total volume.

    Setup: 9 small trades (1 BTC each @ $100k = $100k notional) + 1 large
    trade (10 BTC @ $100k = $1M notional). Total = $1.9M. At 1% threshold,
    cutoff = $19k; all 10 trades exceed → count = 10.
    At 20% threshold, cutoff = $380k; only the 1 large trade exceeds → count = 1.
    """
    buf = get_trade_buffer("BTC")
    buf.clear()
    now_ms = int(time.time() * 1000)
    # 9 small trades
    for i in range(9):
        buf.append({"coin": "BTC", "side": "B", "px": 100000.0, "sz": 1.0, "time": now_ms - i * 100})
    # 1 large trade
    buf.append({"coin": "BTC", "side": "B", "px": 100000.0, "sz": 10.0, "time": now_ms})

    engine = OrderFlowEngine()
    # 1% threshold: all ≥ $19k → count all 10
    lo = engine.large_trade_count("BTC", window_s=3600, threshold_pct_of_window_vol=0.01)
    assert lo["count"] == 10
    # 20% threshold: cutoff $380k; only the $1M trade exceeds
    hi = engine.large_trade_count("BTC", window_s=3600, threshold_pct_of_window_vol=0.20)
    assert hi["count"] == 1
    assert hi["threshold_usd"] == 380000.0
