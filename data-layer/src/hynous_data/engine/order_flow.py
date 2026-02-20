"""Order flow engine — CVD (Cumulative Volume Delta) from trade buffers."""

import time
import logging

from hynous_data.collectors.trade_stream import get_trade_buffer, get_all_buffers

log = logging.getLogger(__name__)


class OrderFlowEngine:
    """Computes buy/sell volume + CVD per coin across configurable windows."""

    def __init__(self, windows: list[int] | None = None):
        self._windows = windows or [60, 300, 900, 3600]  # seconds

    def get_order_flow(self, coin: str) -> dict:
        """Compute order flow metrics for a coin across all windows."""
        buf = get_trade_buffer(coin)
        if not buf:
            return {"coin": coin, "windows": {}, "total_trades": 0}

        now_ms = int(time.time() * 1000)
        results = {}

        for window_s in self._windows:
            cutoff_ms = now_ms - window_s * 1000
            buy_vol = 0.0
            sell_vol = 0.0
            buy_count = 0
            sell_count = 0

            # Snapshot then iterate (deque can be mutated by WS thread)
            for trade in reversed(list(buf)):
                if trade["time"] < cutoff_ms:
                    break
                notional = trade["px"] * trade["sz"]
                if trade["side"] == "B":
                    buy_vol += notional
                    buy_count += 1
                else:
                    sell_vol += notional
                    sell_count += 1

            cvd = buy_vol - sell_vol
            total = buy_vol + sell_vol
            label = f"{window_s // 60}m" if window_s < 3600 else f"{window_s // 3600}h"

            results[label] = {
                "window_seconds": window_s,
                "buy_volume_usd": round(buy_vol, 2),
                "sell_volume_usd": round(sell_vol, 2),
                "cvd": round(cvd, 2),
                "buy_count": buy_count,
                "sell_count": sell_count,
                "buy_pct": round(buy_vol / total * 100, 1) if total else 0,
            }

        return {
            "coin": coin,
            "windows": results,
            "total_trades": len(buf),
        }

    def get_all_cvd_summary(self) -> dict[str, float]:
        """Quick 5m CVD for all coins (for scanner integration)."""
        buffers = get_all_buffers()
        cutoff_ms = int(time.time() * 1000) - 300_000  # 5min
        summary = {}

        for coin, buf in list(buffers.items()):
            buy = 0.0
            sell = 0.0
            for trade in reversed(list(buf)):
                if trade["time"] < cutoff_ms:
                    break
                notional = trade["px"] * trade["sz"]
                if trade["side"] == "B":
                    buy += notional
                else:
                    sell += notional
            summary[coin] = round(buy - sell, 2)

        return summary
