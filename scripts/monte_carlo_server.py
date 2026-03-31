"""Real-time Monte Carlo price projection server.

Connects to VPS data-layer via WebSocket for ~1s tick updates,
runs direction models locally, streams MC projections to browser.

Usage:
    # Start SSH tunnel to data-layer (one-time):
    ssh -L 18100:127.0.0.1:8100 vps -N &

    # Run server:
    python scripts/monte_carlo_server.py

    # Open: http://localhost:8766
"""

import asyncio
import json
import logging
import time
from collections import deque
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS_DIR = PROJECT_ROOT / "satellite" / "artifacts" / "tick_models"
FRONTEND_PATH = PROJECT_ROOT / "scripts" / "monte_carlo.html"

# Data-layer WS endpoint (via SSH tunnel: local 18100 → VPS 8100)
TICK_WS_URL = "ws://localhost:18100/ws/ticks"

N_SIMULATIONS = 200
PRICE_HISTORY_LEN = 300

_clients: set = set()


class TickPredictor:
    def __init__(self):
        import xgboost as xgb
        self._xgb = xgb
        self._models = {}
        self._price_history: deque = deque(maxlen=PRICE_HISTORY_LEN)
        self._tick_buffer: deque = deque(maxlen=60)  # last 60 ticks for rolling features
        self._load_models()

    def _load_models(self):
        xgb = self._xgb
        for model_dir in sorted(ARTIFACTS_DIR.iterdir()):
            if not model_dir.is_dir():
                continue
            model_path = model_dir / "model.json"
            meta_path = model_dir / "metadata.json"
            if not model_path.exists() or not meta_path.exists():
                continue
            try:
                with open(meta_path) as f:
                    meta = json.load(f)
                booster = xgb.Booster()
                booster.load_model(str(model_path))
                self._models[meta["name"]] = {
                    "booster": booster,
                    "horizon": meta["horizon_seconds"],
                    "features": meta["feature_names"],
                }
                log.info("Loaded %s (%ds)", meta["name"], meta["horizon_seconds"])
            except Exception as e:
                log.warning("Failed to load %s: %s", model_dir.name, e)
        log.info("%d tick models loaded", len(self._models))

    def on_tick(self, snap: dict) -> dict | None:
        """Process one tick snapshot, run models, return MC result."""
        mid_price = snap.get("mid_price", 0)
        ts = snap.get("timestamp", 0)
        if not mid_price or mid_price <= 0:
            return None

        # Accumulate
        self._price_history.append((ts, mid_price))
        self._tick_buffer.append(snap)

        # Build features
        features = self._build_features()

        # Run models
        predictions = {}
        for name, m in self._models.items():
            try:
                fv = np.array([features.get(f, 0.0) for f in m["features"]], dtype=np.float32).reshape(1, -1)
                dmat = self._xgb.DMatrix(fv, feature_names=m["features"])
                predictions[m["horizon"]] = float(m["booster"].predict(dmat)[0])
            except Exception:
                pass

        # Volatility
        if len(self._price_history) >= 10:
            prices = np.array([p for _, p in self._price_history])[-60:]
            rets = np.diff(prices) / prices[:-1]
            vol = float(np.std(rets)) if len(rets) > 1 else 0.0001
        else:
            vol = 0.0001

        mc = self._simulate(mid_price, predictions, vol)

        return {
            "timestamp": ts,
            "mid_price": mid_price,
            "predictions": predictions,
            "mc_paths": mc,
            "vol_per_sec": vol,
            "price_history": list(self._price_history),
        }

    def _build_features(self) -> dict:
        BASE_TICK_FEATURES = [
            "book_imbalance_5", "book_imbalance_10", "book_imbalance_20",
            "bid_depth_usd_5", "ask_depth_usd_5", "spread_pct", "mid_price",
            "buy_vwap_deviation", "sell_vwap_deviation",
            "flow_imbalance_10s", "flow_imbalance_30s", "flow_imbalance_60s",
            "flow_intensity_10s", "flow_intensity_30s",
            "trade_volume_10s_usd", "trade_volume_30s_usd",
            "price_change_10s", "price_change_30s", "price_change_60s",
            "large_trade_imbalance",
            "book_imbalance_delta_5s", "book_imbalance_delta_10s",
            "depth_ratio_change_5s",
            "max_trade_usd_60s", "trade_count_60s", "trade_count_10s",
        ]

        rows = list(self._tick_buffer)
        latest = rows[-1]
        features = {f: (latest.get(f) or 0.0) for f in BASE_TICK_FEATURES}

        if len(rows) >= 5:
            def _col(name):
                return [r.get(name) or 0.0 for r in rows]

            book_imb = _col("book_imbalance_5")
            flow_imb = _col("flow_imbalance_10s")
            price_chg = _col("price_change_10s")
            mid_arr = _col("mid_price")
            n = len(rows)

            features["book_imbalance_5_mean5"] = float(np.mean(book_imb[-5:]))
            features["flow_imbalance_10s_mean5"] = float(np.mean(flow_imb[-5:]))
            features["price_change_10s_mean5"] = float(np.mean(price_chg[-5:]))
            features["book_imbalance_5_mean10"] = float(np.mean(book_imb[-min(10, n):]))
            features["flow_imbalance_10s_mean10"] = float(np.mean(flow_imb[-min(10, n):]))

            w30 = min(30, n)
            features["book_imbalance_5_std30"] = float(np.std(book_imb[-w30:]))
            features["flow_imbalance_10s_std30"] = float(np.std(flow_imb[-w30:]))
            features["price_change_10s_std30"] = float(np.std(price_chg[-w30:]))

            for arr, slope_name in [
                (book_imb, "book_imbalance_5_slope60"),
                (flow_imb, "flow_imbalance_10s_slope60"),
                (mid_arr, "mid_price_slope60"),
            ]:
                seg = np.array(arr[-min(60, n):], dtype=np.float32)
                if len(seg) >= 3:
                    t = np.arange(len(seg), dtype=np.float32)
                    t_m, y_m = t.mean(), seg.mean()
                    cov = np.sum((t - t_m) * (seg - y_m))
                    var = np.sum((t - t_m) ** 2)
                    features[slope_name] = float(cov / var) if var > 0 else 0.0
                else:
                    features[slope_name] = 0.0
        else:
            ROLLING_FEATURES = [
                "book_imbalance_5_mean5", "flow_imbalance_10s_mean5", "price_change_10s_mean5",
                "book_imbalance_5_mean10", "flow_imbalance_10s_mean10",
                "book_imbalance_5_std30", "flow_imbalance_10s_std30", "price_change_10s_std30",
                "book_imbalance_5_slope60", "flow_imbalance_10s_slope60", "mid_price_slope60",
            ]
            for rf in ROLLING_FEATURES:
                features.setdefault(rf, 0.0)

        return features

    def _simulate(self, price: float, predictions: dict, vol: float) -> dict:
        max_h = 180
        step = 3
        n_steps = max_h // step
        tps = list(range(0, max_h + 1, step))

        sorted_h = sorted([int(k) for k in predictions.keys() if int(k) > 0])
        def get_drift(sec):
            if not sorted_h: return 0
            if sec <= sorted_h[0]: return predictions.get(sorted_h[0], predictions.get(str(sorted_h[0]), 0)) / sorted_h[0] / 10000
            if sec >= sorted_h[-1]: return predictions.get(sorted_h[-1], predictions.get(str(sorted_h[-1]), 0)) / sorted_h[-1] / 10000
            for i in range(len(sorted_h) - 1):
                if sorted_h[i] <= sec <= sorted_h[i+1]:
                    h1, h2 = sorted_h[i], sorted_h[i+1]
                    p1 = predictions.get(h1, predictions.get(str(h1), 0))
                    p2 = predictions.get(h2, predictions.get(str(h2), 0))
                    d1, d2 = p1/h1/10000, p2/h2/10000
                    return d1 + (d2-d1)*(sec-h1)/(h2-h1)
            return 0

        rng = np.random.default_rng()
        paths = np.zeros((N_SIMULATIONS, len(tps)))
        paths[:, 0] = price
        for ti in range(1, len(tps)):
            sec = tps[ti]
            drift = sum(get_drift(tps[ti-1] + s + 1) for s in range(step))
            noise = rng.normal(0, vol * np.sqrt(step), N_SIMULATIONS)
            paths[:, ti] = paths[:, ti-1] * (1 + drift + noise)

        bands = {}
        for ti, t in enumerate(tps):
            col = np.sort(paths[:, ti])
            pctile = lambda p: float(col[int(len(col) * p / 100)])
            bands[t] = {
                "p5": pctile(5), "p10": pctile(10), "p25": pctile(25), "p50": pctile(50),
                "p75": pctile(75), "p90": pctile(90), "p95": pctile(95),
            }

        sample_idx = rng.choice(N_SIMULATIONS, size=min(15, N_SIMULATIONS), replace=False)
        samples = paths[sample_idx].tolist()

        return {
            "percentile_bands": bands,
            "sample_paths": samples,
            "time_points": tps,
            "n_simulations": N_SIMULATIONS,
        }


predictor = TickPredictor()


# ─── VPS Tick WebSocket Consumer ─────────────────────────────────────────

async def vps_tick_consumer():
    """Connect to data-layer WS and broadcast each tick to browser clients."""
    import websockets

    while True:
        try:
            log.info("Connecting to VPS tick stream: %s", TICK_WS_URL)
            async with websockets.connect(TICK_WS_URL, ping_interval=20) as ws:
                log.info("Connected to VPS tick stream")
                async for raw in ws:
                    try:
                        snap = json.loads(raw)
                        if "error" in snap:
                            log.warning("VPS tick error: %s", snap["error"])
                            continue

                        result = predictor.on_tick(snap)
                        if result and _clients:
                            msg = json.dumps(result, default=str)
                            await asyncio.gather(
                                *[c.send(msg) for c in _clients.copy()],
                                return_exceptions=True,
                            )
                    except Exception:
                        log.debug("Tick processing error", exc_info=True)
        except Exception as e:
            log.warning("VPS tick stream disconnected: %s — reconnecting in 3s", e)
        await asyncio.sleep(3)


# ─── Browser WebSocket Handler ───────────────────────────────────────────

async def handler(websocket):
    _clients.add(websocket)
    log.info("Browser client connected (%d total)", len(_clients))
    try:
        async for _ in websocket:
            pass
    except Exception:
        pass
    finally:
        _clients.discard(websocket)
        log.info("Browser client disconnected (%d remaining)", len(_clients))


def _start_http_server():
    from http.server import HTTPServer, SimpleHTTPRequestHandler
    import threading

    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(FRONTEND_PATH.read_bytes())
        def log_message(self, *a):
            pass

    httpd = HTTPServer(("localhost", 8766), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    log.info("HTML served at http://localhost:8766")


async def main():
    import websockets.asyncio.server

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )

    _start_http_server()

    log.info("Monte Carlo server on ws://localhost:8765")
    log.info("Open http://localhost:8766")
    log.info("Requires SSH tunnel: ssh -L 18100:127.0.0.1:8100 vps -N")

    server = await websockets.asyncio.server.serve(handler, "localhost", 8765)

    # Start consuming VPS tick stream
    consumer_task = asyncio.create_task(vps_tick_consumer())

    await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
