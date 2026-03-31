"""Real-time Monte Carlo price projection server.

Runs tick direction models on live VPS data, simulates price paths,
streams results to browser via WebSocket.

Usage:
    python scripts/monte_carlo_server.py
    # Then open scripts/monte_carlo.html in browser
"""

import asyncio
import json
import logging
import subprocess
import time
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS_DIR = PROJECT_ROOT / "satellite" / "artifacts" / "tick_models"
FRONTEND_PATH = PROJECT_ROOT / "scripts" / "monte_carlo.html"

VPS_HOST = "vps"
N_SIMULATIONS = 200
HORIZONS = [10, 15, 20, 30, 45, 60, 120, 180]
UPDATE_INTERVAL = 10.0
PRICE_HISTORY_LEN = 300

_clients: set = set()

# VPS query script file (avoids shell quoting hell)
_VPS_QUERY_SCRIPT = PROJECT_ROOT / "scripts" / "_mc_query.py"


class TickPredictor:
    def __init__(self):
        import xgboost as xgb
        self._xgb = xgb
        self._models = {}
        self._price_history: list[tuple[float, float]] = []
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

    def fetch_and_predict(self, rows_json: str) -> dict | None:
        """Run models on tick data returned from VPS."""
        try:
            rows = json.loads(rows_json)
        except Exception:
            return None

        if not rows:
            return None

        rows.reverse()  # DESC → ASC
        latest = rows[-1]
        mid_price = latest.get("mid_price", 0)
        if not mid_price or mid_price <= 0:
            return None

        # Update price history
        for r in rows:
            ts, px = r.get("timestamp", 0), r.get("mid_price", 0)
            if ts and px:
                self._price_history.append((ts, px))
        seen = set()
        unique = []
        for ts, px in self._price_history:
            if ts not in seen:
                seen.add(ts)
                unique.append((ts, px))
        self._price_history = sorted(unique)[-PRICE_HISTORY_LEN:]

        # Build features
        features = self._build_features(rows)

        # Run models
        predictions = {}
        for name, m in self._models.items():
            try:
                fv = np.array([features.get(f, 0.0) for f in m["features"]], dtype=np.float32).reshape(1, -1)
                dmat = self._xgb.DMatrix(fv, feature_names=m["features"])
                predictions[m["horizon"]] = float(m["booster"].predict(dmat)[0])
            except Exception:
                pass

        # Volatility estimate
        if len(self._price_history) >= 10:
            prices = np.array([p for _, p in self._price_history[-60:]])
            rets = np.diff(prices) / prices[:-1]
            vol = float(np.std(rets)) if len(rets) > 1 else 0.0001
        else:
            vol = 0.0001

        mc = self._simulate(mid_price, predictions, vol)

        return {
            "timestamp": latest.get("timestamp", 0),
            "mid_price": mid_price,
            "predictions": predictions,
            "mc_paths": mc,
            "vol_per_sec": vol,
            "price_history": self._price_history[-PRICE_HISTORY_LEN:],
        }

    def _build_features(self, rows: list[dict]) -> dict:
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
        ROLLING_FEATURES = [
            "book_imbalance_5_mean5", "flow_imbalance_10s_mean5", "price_change_10s_mean5",
            "book_imbalance_5_mean10", "flow_imbalance_10s_mean10",
            "book_imbalance_5_std30", "flow_imbalance_10s_std30", "price_change_10s_std30",
            "book_imbalance_5_slope60", "flow_imbalance_10s_slope60", "mid_price_slope60",
        ]

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
            for rf in ROLLING_FEATURES:
                features.setdefault(rf, 0.0)

        return features

    def _simulate(self, price: float, predictions: dict, vol: float) -> dict:
        max_h = max(HORIZONS)
        n_steps = max_h

        # Interpolate drift from predictions
        drift = np.zeros(n_steps)
        if predictions:
            sorted_h = sorted(predictions.keys())
            for t in range(n_steps):
                sec = t + 1
                if sec <= sorted_h[0]:
                    drift[t] = predictions[sorted_h[0]] / sorted_h[0] / 10000
                elif sec >= sorted_h[-1]:
                    drift[t] = predictions[sorted_h[-1]] / sorted_h[-1] / 10000
                else:
                    for i in range(len(sorted_h) - 1):
                        if sorted_h[i] <= sec <= sorted_h[i + 1]:
                            h1, h2 = sorted_h[i], sorted_h[i + 1]
                            d1 = predictions[h1] / h1 / 10000
                            d2 = predictions[h2] / h2 / 10000
                            frac = (sec - h1) / (h2 - h1)
                            drift[t] = d1 + (d2 - d1) * frac
                            break

        rng = np.random.default_rng()
        paths = np.zeros((N_SIMULATIONS, n_steps + 1))
        paths[:, 0] = price
        for t in range(n_steps):
            noise = rng.normal(0, vol, N_SIMULATIONS)
            paths[:, t + 1] = paths[:, t] * (1 + drift[t] + noise)

        # Subsample time points for JSON efficiency
        step = max(1, n_steps // 60)
        time_points = list(range(0, n_steps + 1, step))
        if n_steps not in time_points:
            time_points.append(n_steps)

        bands = {}
        for t in time_points:
            col = paths[:, t]
            bands[t] = {
                "p5": float(np.percentile(col, 5)),
                "p10": float(np.percentile(col, 10)),
                "p25": float(np.percentile(col, 25)),
                "p50": float(np.percentile(col, 50)),
                "p75": float(np.percentile(col, 75)),
                "p90": float(np.percentile(col, 90)),
                "p95": float(np.percentile(col, 95)),
            }

        sample_idx = rng.choice(N_SIMULATIONS, size=min(20, N_SIMULATIONS), replace=False)
        samples = paths[sample_idx][:, ::step].tolist()

        return {
            "percentile_bands": bands,
            "sample_paths": samples,
            "time_points": time_points,
            "n_simulations": N_SIMULATIONS,
        }


predictor = TickPredictor()


_QUERY_SCRIPT = """\
import sqlite3,json
conn=sqlite3.connect("storage/satellite.db")
conn.row_factory=sqlite3.Row
rows=conn.execute("SELECT * FROM tick_snapshots WHERE coin=? AND schema_version=2 ORDER BY timestamp DESC LIMIT 60",("BTC",)).fetchall()
conn.close()
print(json.dumps([dict(r) for r in rows]))
"""


async def fetch_vps_data() -> str | None:
    """SSH to VPS, pipe Python script via stdin."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ssh", VPS_HOST,
            "cd /opt/hynous && .venv/bin/python3 -",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=_QUERY_SCRIPT.encode()),
            timeout=10,
        )
        if proc.returncode != 0:
            log.warning("SSH failed: %s", stderr.decode()[:200])
            return None
        return stdout.decode().strip()
    except asyncio.TimeoutError:
        log.warning("SSH timed out")
        return None
    except Exception as e:
        log.warning("SSH error: %s", e)
        return None


async def handler(websocket):
    _clients.add(websocket)
    log.info("Client connected (%d total)", len(_clients))
    try:
        # Send data immediately on connect
        raw = await fetch_vps_data()
        if raw:
            result = predictor.fetch_and_predict(raw)
            if result:
                await websocket.send(json.dumps(result, default=str))
                log.info("Sent initial data to client")

        async for _ in websocket:
            pass
    except Exception:
        pass
    finally:
        _clients.discard(websocket)
        log.info("Client disconnected (%d remaining)", len(_clients))


async def broadcast_loop():
    while True:
        await asyncio.sleep(UPDATE_INTERVAL)
        if not _clients:
            continue
        try:
            raw = await fetch_vps_data()
            if not raw:
                continue
            result = predictor.fetch_and_predict(raw)
            if not result:
                continue
            msg = json.dumps(result, default=str)
            await asyncio.gather(
                *[c.send(msg) for c in _clients.copy()],
                return_exceptions=True,
            )
        except Exception:
            log.exception("Broadcast error")


def _start_http_server():
    """Serve HTML on port 8766 in a background thread."""
    from http.server import HTTPServer, SimpleHTTPRequestHandler

    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(FRONTEND_PATH.read_bytes())

        def log_message(self, *a):
            pass

    import threading
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

    log.info("Monte Carlo server starting on ws://localhost:8765")
    log.info("Open http://localhost:8766 in your browser")

    server = await websockets.asyncio.server.serve(handler, "localhost", 8765)
    broadcast_task = asyncio.create_task(broadcast_loop())
    await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
