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
