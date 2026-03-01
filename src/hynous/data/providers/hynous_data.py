"""
Hynous-Data Client — HTTP wrapper for the data layer service.

Talks to hynous-data running on localhost:8100.
Provides liquidation heatmaps, order flow, whale tracking, HLP positions, smart money.

Singleton pattern — use get_client() to get the shared instance.
Sync (requests.Session) — matches the rest of the Hynous stack.
"""

import logging
import threading
from typing import Optional

import requests

from ...core.config import load_config

log = logging.getLogger(__name__)

_client: Optional["HynousDataClient"] = None
_client_lock = threading.Lock()


def get_client() -> "HynousDataClient":
    """Get or create the singleton HynousDataClient. Thread-safe."""
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:  # double-check under lock
                cfg = load_config()
                _client = HynousDataClient(
                    base_url=cfg.data_layer.url,
                    timeout=cfg.data_layer.timeout,
                )
    return _client


class HynousDataClient:
    """HTTP client for the hynous-data service.

    Thread-safe — uses a lock around the shared requests.Session.
    """

    def __init__(self, base_url: str = "http://127.0.0.1:8100", timeout: int = 5):
        self.base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._session = requests.Session()
        self._lock = threading.Lock()
        self._available = False
        log.info("HynousDataClient initialized → %s", self.base_url)

    def _get(self, path: str, params: dict | None = None) -> dict | None:
        """GET request with timeout and graceful failure.

        Thread-safe. Handles ConnectionError, Timeout, HTTPError, and
        malformed JSON gracefully. Sets _available flag only on full success.
        """
        try:
            with self._lock:
                resp = self._session.get(
                    f"{self.base_url}{path}",
                    params=params,
                    timeout=self._timeout,
                )
            resp.raise_for_status()
            data = resp.json()
            self._available = True
            return data
        except (requests.ConnectionError, requests.Timeout):
            if self._available:
                log.warning("hynous-data unavailable at %s", self.base_url)
            self._available = False
            return None
        except requests.HTTPError as e:
            log.warning("hynous-data HTTP error: %s %s", e.response.status_code, path)
            self._available = False
            return None
        except Exception:
            log.debug("hynous-data request failed: %s", path, exc_info=True)
            return None

    def _post(self, path: str, json_body: dict) -> dict | None:
        """POST request with timeout and graceful failure."""
        try:
            with self._lock:
                resp = self._session.post(
                    f"{self.base_url}{path}",
                    json=json_body,
                    timeout=self._timeout,
                )
            resp.raise_for_status()
            data = resp.json()
            self._available = True
            return data
        except (requests.ConnectionError, requests.Timeout):
            if self._available:
                log.warning("hynous-data unavailable at %s", self.base_url)
            self._available = False
            return None
        except requests.HTTPError as e:
            log.warning("hynous-data HTTP error: %s %s", e.response.status_code, path)
            return None
        except Exception:
            log.debug("hynous-data request failed: %s", path, exc_info=True)
            return None

    def _patch(self, path: str, json_body: dict) -> dict | None:
        """PATCH request with timeout and graceful failure."""
        try:
            with self._lock:
                resp = self._session.patch(
                    f"{self.base_url}{path}",
                    json=json_body,
                    timeout=self._timeout,
                )
            resp.raise_for_status()
            data = resp.json()
            self._available = True
            return data
        except (requests.ConnectionError, requests.Timeout):
            if self._available:
                log.warning("hynous-data unavailable at %s", self.base_url)
            self._available = False
            return None
        except requests.HTTPError as e:
            log.warning("hynous-data HTTP error: %s %s", e.response.status_code, path)
            return None
        except Exception:
            log.debug("hynous-data request failed: %s", path, exc_info=True)
            return None

    def _delete(self, path: str) -> dict | None:
        """DELETE request with timeout and graceful failure."""
        try:
            with self._lock:
                resp = self._session.delete(
                    f"{self.base_url}{path}",
                    timeout=self._timeout,
                )
            resp.raise_for_status()
            data = resp.json()
            self._available = True
            return data
        except (requests.ConnectionError, requests.Timeout):
            if self._available:
                log.warning("hynous-data unavailable at %s", self.base_url)
            self._available = False
            return None
        except requests.HTTPError as e:
            log.warning("hynous-data HTTP error: %s %s", e.response.status_code, path)
            return None
        except Exception:
            log.debug("hynous-data request failed: %s", path, exc_info=True)
            return None

    @property
    def is_available(self) -> bool:
        return self._available

    # ---- Health ----

    def health(self) -> dict | None:
        return self._get("/health")

    # ---- Liquidation Heatmap ----

    def heatmap(self, coin: str) -> dict | None:
        """Get liquidation heatmap for a coin."""
        return self._get(f"/v1/heatmap/{coin.upper()}")

    def heatmap_summary(self, coin: str) -> str | None:
        """Get a compact text summary of the heatmap for context injection."""
        data = self.heatmap(coin)
        if not data or "error" in data:
            return None

        s = data.get("summary", {})
        mid = data.get("mid_price", 0)
        long_liq = s.get("total_long_liq_usd", 0)
        short_liq = s.get("total_short_liq_usd", 0)

        # Find densest buckets
        buckets = data.get("buckets", [])
        dense_long = max(buckets, key=lambda b: b["long_liq_usd"], default=None)
        dense_short = max(buckets, key=lambda b: b["short_liq_usd"], default=None)

        parts = [f"{coin} heatmap (mid ${mid:,.0f}): ${long_liq:,.0f} long liqs, ${short_liq:,.0f} short liqs"]
        if dense_long and dense_long["long_liq_usd"] > 0:
            parts.append(f"  Dense long liqs near ${dense_long['price_mid']:,.0f} (${dense_long['long_liq_usd']:,.0f})")
        if dense_short and dense_short["short_liq_usd"] > 0:
            parts.append(f"  Dense short liqs near ${dense_short['price_mid']:,.0f} (${dense_short['short_liq_usd']:,.0f})")
        return "\n".join(parts)

    # ---- HLP Vault ----

    def hlp_positions(self) -> dict | None:
        """Get current HLP vault positions."""
        return self._get("/v1/hlp/positions")

    def hlp_sentiment(self, hours: float = 24) -> dict | None:
        """Get HLP sentiment (side flips, deltas)."""
        return self._get("/v1/hlp/sentiment", params={"hours": hours})

    def hlp_summary(self) -> str | None:
        """Compact HLP summary for context injection."""
        data = self.hlp_positions()
        if not data:
            return None

        positions = data.get("positions", [])
        if not positions:
            return "HLP: no open positions"

        # Top 5 by size
        sorted_pos = sorted(positions, key=lambda p: p.get("size_usd", 0), reverse=True)[:5]
        lines = ["HLP vault positions (top 5):"]
        for p in sorted_pos:
            lines.append(f"  {p['coin']} {p['side']} ${p['size_usd']:,.0f} ({p.get('leverage', 1):.0f}x)")
        return "\n".join(lines)

    # ---- Order Flow ----

    def order_flow(self, coin: str) -> dict | None:
        """Get order flow / CVD for a coin."""
        return self._get(f"/v1/orderflow/{coin.upper()}")

    def order_flow_summary(self, coin: str) -> str | None:
        """Compact CVD summary for context injection."""
        data = self.order_flow(coin)
        if not data:
            return None

        windows = data.get("windows", {})
        if not windows:
            return None

        parts = [f"{coin} order flow:"]
        for label, w in windows.items():
            cvd = w.get("cvd", 0)
            buy_pct = w.get("buy_pct", 50)
            if abs(cvd) < 1000:
                direction = "NEUTRAL"
            elif cvd > 0:
                direction = "BUY"
            else:
                direction = "SELL"
            parts.append(f"  {label}: CVD ${cvd:+,.0f} ({buy_pct:.0f}% buys) -> {direction} pressure")
        return "\n".join(parts)

    # ---- Whales ----

    def whales(self, coin: str, top_n: int = 50) -> dict | None:
        """Get largest positions for a coin."""
        return self._get(f"/v1/whales/{coin.upper()}", params={"top_n": top_n})

    def whale_summary(self, coin: str, top_n: int = 10) -> str | None:
        """Compact whale summary for context injection."""
        data = self.whales(coin, top_n)
        if not data:
            return None

        net = data.get("net_usd", 0)
        long_usd = data.get("total_long_usd", 0)
        short_usd = data.get("total_short_usd", 0)
        count = data.get("count", 0)
        bias = "LONG" if net > 0 else "SHORT"

        return (
            f"{coin} whales (top {count}): "
            f"${long_usd:,.0f} long, ${short_usd:,.0f} short → net {bias} ${abs(net):,.0f}"
        )

    # ---- Smart Money ----

    def smart_money(self, top_n: int = 50, min_win_rate: float = 0,
                    style: str = "", exclude_bots: bool = False,
                    min_trades: int = 0) -> dict | None:
        """Get most profitable traders with optional filters."""
        params: dict = {"top_n": top_n}
        if min_win_rate:
            params["min_win_rate"] = min_win_rate
        if style:
            params["style"] = style
        if exclude_bots:
            params["exclude_bots"] = "true"
        if min_trades:
            params["min_trades"] = min_trades
        return self._get("/v1/smart-money", params=params)

    # ---- Smart Money: Wallet Tracker ----

    def sm_watchlist(self) -> dict | None:
        return self._get("/v1/smart-money/watchlist")

    def sm_profile(self, address: str, days: int = 30) -> dict | None:
        return self._get(f"/v1/smart-money/wallet/{address}", {"days": days})

    def sm_trades(self, address: str, limit: int = 50) -> dict | None:
        return self._get(f"/v1/smart-money/wallet/{address}/trades", {"limit": limit})

    def sm_changes(self, minutes: int = 30) -> dict | None:
        return self._get("/v1/smart-money/changes", {"minutes": minutes})

    def sm_watch(self, address: str, label: str = "") -> dict | None:
        return self._post("/v1/smart-money/watch", {"address": address, "label": label})

    def sm_unwatch(self, address: str) -> dict | None:
        return self._delete(f"/v1/smart-money/watch/{address}")

    def sm_update(self, address: str, label: str | None = None,
                  notes: str | None = None, tags: str | None = None) -> dict | None:
        """Update label/notes/tags on a tracked wallet."""
        body: dict = {}
        if label is not None:
            body["label"] = label
        if notes is not None:
            body["notes"] = notes
        if tags is not None:
            body["tags"] = tags
        return self._patch(f"/v1/smart-money/watch/{address}", body)

    def sm_create_alert(self, address: str, alert_type: str,
                        min_size_usd: float = 0, coins: str = "") -> dict | None:
        return self._post(f"/v1/smart-money/wallet/{address}/alerts", {
            "alert_type": alert_type,
            "min_size_usd": min_size_usd,
            "coins": coins,
        })

    def sm_list_alerts(self, address: str) -> dict | None:
        return self._get(f"/v1/smart-money/wallet/{address}/alerts")

    def sm_delete_alert(self, alert_id: int) -> dict | None:
        return self._delete(f"/v1/smart-money/alert/{alert_id}")

    def sm_active_alerts(self) -> dict | None:
        return self._get("/v1/smart-money/alerts/active")

    # ---- Historical Recording (SPEC-01) ----

    def record_historical(
        self,
        funding: dict[str, float],
        oi: dict[str, float],
        volume: dict[str, float],
    ) -> dict | None:
        """Record funding/OI/volume snapshots to historical tables."""
        return self._post("/v1/historical/record", {
            "funding": funding,
            "oi": oi,
            "volume": volume,
        })

    # ---- Stats ----

    def stats(self) -> dict | None:
        return self._get("/v1/stats")
