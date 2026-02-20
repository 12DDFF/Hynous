"""Integration smoke test — connects to real Hyperliquid, validates end-to-end.

Run with: python3 -m pytest tests/test_smoke.py -v -s
(Takes ~45 seconds — connects to live WS + polls real data)
"""

import time
import threading
import pytest

from hynous_data.core.config import load_config
from hynous_data.core.db import Database
from hynous_data.core.rate_limiter import RateLimiter
from hynous_data.collectors.trade_stream import TradeStream, clear_all_buffers, get_all_buffers
from hynous_data.collectors.position_poller import PositionPoller
from hynous_data.collectors.hlp_tracker import HlpTracker
from hynous_data.engine.order_flow import OrderFlowEngine
from hynous_data.engine.liq_heatmap import LiqHeatmapEngine
from hynous_data.engine.smart_money import SmartMoneyEngine
from hynous_data.api.app import create_app

BASE_URL = "https://api.hyperliquid.xyz"


@pytest.fixture
def db(tmp_path):
    """Create a temporary database."""
    d = Database(tmp_path / "test.db")
    d.connect()
    d.init_schema()
    yield d
    d.close()


@pytest.fixture
def rate_limiter():
    return RateLimiter(max_weight=1200, safety_pct=85)


class TestTradeStreamLive:
    """Test that the WS actually receives trades and discovers addresses."""

    def test_ws_receives_trades(self, db):
        """Connect to live WS, wait 15s, verify trades arrive."""
        clear_all_buffers()
        ts = TradeStream(db, base_url=BASE_URL)
        ts.start()

        # Wait for WS to connect and receive some trades
        time.sleep(15)

        try:
            assert ts.total_trades > 0, "No trades received — WS may be broken"
            assert ts.is_healthy, "WS not healthy after 15s"

            # Check trade buffers have data
            buffers = get_all_buffers()
            assert len(buffers) > 0, "No trade buffers created"

            # Check at least one popular coin has trades
            btc_buf = buffers.get("BTC", [])
            eth_buf = buffers.get("ETH", [])
            assert len(btc_buf) > 0 or len(eth_buf) > 0, "No BTC or ETH trades"

            # Validate trade data quality
            for coin, buf in list(buffers.items())[:5]:
                for trade in list(buf)[:3]:
                    assert trade["px"] > 0, f"Invalid price in {coin} trade"
                    assert trade["sz"] > 0, f"Invalid size in {coin} trade"
                    assert trade["side"] in ("B", "A"), f"Invalid side in {coin} trade"
                    assert trade["time"] > 0, f"Invalid time in {coin} trade"

            print(f"\n  Trades received: {ts.total_trades}")
            print(f"  Invalid trades: {ts.total_invalid_trades}")
            print(f"  Coins with trades: {len(buffers)}")
            print(f"  WS healthy: {ts.is_healthy}")

            # Check address discovery
            stats = ts.stats()
            print(f"  Addresses discovered: {stats['total_addresses_discovered']}")
            if stats["total_addresses_discovered"] == 0:
                print("  WARNING: No addresses discovered — 'users' field may not be in WS payload")
                print("  This is non-fatal: order flow still works, but position poller needs addresses")

        finally:
            ts.stop()

    def test_invalid_trades_rejected(self, db):
        """Verify that corrupt data doesn't make it into buffers."""
        clear_all_buffers()
        ts = TradeStream(db, base_url=BASE_URL)

        # Simulate corrupt trade callback
        ts._on_trade({
            "channel": "trades",
            "data": [
                {"coin": "BTC", "side": "B", "px": "NaN", "sz": "1", "time": 0},
                {"coin": "", "side": "B", "px": "100", "sz": "1", "time": 0},
                {"coin": "BTC", "side": "X", "px": "100", "sz": "1", "time": 0},
                {"coin": "BTC", "side": "B", "px": "0", "sz": "1", "time": 0},
                {"coin": "BTC", "side": "B", "px": "100", "sz": "0", "time": 0},
            ]
        })

        assert ts.total_trades == 0, "Corrupt trades should be rejected"
        assert ts.total_invalid_trades == 5, f"Expected 5 invalid, got {ts.total_invalid_trades}"


class TestHlpTrackerLive:
    """Test HLP vault polling against real API."""

    def test_hlp_returns_positions(self, db, rate_limiter):
        """Poll real HLP vaults and verify we get positions."""
        cfg = load_config()
        hlp = HlpTracker(db, rate_limiter, cfg.hlp_tracker, base_url=BASE_URL)

        # Poll once directly (don't start thread)
        hlp._poll_all_vaults()

        positions = hlp.get_positions()
        print(f"\n  HLP positions found: {len(positions)}")
        for p in positions[:5]:
            print(f"    {p['coin']} {p['side']} ${p['size_usd']:,.0f} ({p['leverage']}x)")

        assert len(positions) > 0, "HLP vaults should have positions"
        for p in positions:
            assert p["entry_px"] > 0, f"Invalid entry_px for {p['coin']}"
            assert p["size"] > 0, f"Invalid size for {p['coin']}"
            assert p["leverage"] > 0 and p["leverage"] <= 200, f"Invalid leverage for {p['coin']}"


class TestPositionPollerLive:
    """Test position polling with a known address."""

    def test_poll_known_address(self, db, rate_limiter):
        """Poll HLP vault addresses to validate parsing. Try each until one has positions."""
        cfg = load_config()
        pp = PositionPoller(db, rate_limiter, cfg.position_poller, base_url=BASE_URL)
        smart = SmartMoneyEngine(db)
        pp.set_smart_money(smart)

        # Try each vault — some are cash vaults with no positions
        found_positions = False
        for vault in cfg.hlp_tracker.vaults:
            positions, total_size, active_coins = pp._poll_address(vault)
            assert positions is not None, f"Failed to poll address {vault[:10]}"
            print(f"\n  Positions for {vault[:10]}...: {len(positions)} (${total_size:,.0f})")

            if positions:
                found_positions = True
                for p in positions[:5]:
                    assert p["entry_px"] > 0
                    assert p["size_usd"] > 0
                    assert p["side"] in ("long", "short")
                    assert p["leverage"] > 0 and p["leverage"] <= 200
                    print(f"    {p['coin']} {p['side']} ${p['size_usd']:,.0f} liq={p['liq_px']}")
                break

        assert found_positions, "None of the vault addresses have positions"


class TestOrderFlowLive:
    """Test order flow computation with real trade data."""

    def test_cvd_with_live_data(self, db):
        """Get live trades, then compute CVD."""
        clear_all_buffers()
        ts = TradeStream(db, base_url=BASE_URL)
        ts.start()
        time.sleep(10)  # Collect some trades

        engine = OrderFlowEngine(windows=[60, 300])
        result = engine.get_order_flow("BTC")

        print(f"\n  BTC order flow:")
        for label, w in result.get("windows", {}).items():
            print(f"    {label}: buy=${w['buy_volume_usd']:,.0f} sell=${w['sell_volume_usd']:,.0f} CVD=${w['cvd']:,.0f}")

        ts.stop()

        # Should have at least some data
        assert result["total_trades"] > 0, "No BTC trades for order flow"


class TestAPILive:
    """Test that API endpoints work with live data."""

    def test_api_endpoints(self, db, rate_limiter):
        """Start API with minimal components, test endpoints."""
        from fastapi.testclient import TestClient

        cfg = load_config()

        # Build minimal components
        smart = SmartMoneyEngine(db)
        hlp = HlpTracker(db, rate_limiter, cfg.hlp_tracker, base_url=BASE_URL)
        hlp._poll_all_vaults()  # Pre-fill data

        from hynous_data.engine.whale_tracker import WhaleTracker
        components = {
            "db": db,
            "rate_limiter": rate_limiter,
            "start_time": time.time(),
            "order_flow": OrderFlowEngine(),
            "liq_heatmap": LiqHeatmapEngine(db, cfg.heatmap, base_url=BASE_URL),
            "whale_tracker": WhaleTracker(db),
            "smart_money": smart,
            "hlp_tracker": hlp,
        }

        app = create_app(components)
        client = TestClient(app)

        # /health
        r = client.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] in ("ok", "degraded")
        print(f"\n  /health: {data}")

        # /v1/hlp/positions
        r = client.get("/v1/hlp/positions")
        assert r.status_code == 200
        data = r.json()
        assert "positions" in data
        print(f"  /v1/hlp/positions: {data['count']} positions")

        # /v1/orderflow/BTC (empty — no trade stream running)
        r = client.get("/v1/orderflow/BTC")
        assert r.status_code == 200

        # /v1/stats
        r = client.get("/v1/stats")
        assert r.status_code == 200
        assert "rate_limiter" in r.json()

        # /v1/heatmap/BTC (may be empty — 404 if no position data)
        r = client.get("/v1/heatmap/BTC")
        assert r.status_code in (200, 404)

        print("  All API endpoints: OK")
