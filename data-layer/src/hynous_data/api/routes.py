"""REST API endpoints for hynous-data."""

import time
from fastapi import APIRouter, Query, Body
from fastapi.responses import JSONResponse


def create_router(c: dict) -> APIRouter:
    """Create router with all endpoints. `c` is the components dict from main."""
    router = APIRouter()

    @router.get("/health")
    def health():
        db = c["db"]
        start_time = c.get("start_time", 0)
        addr_count = db.conn.execute("SELECT COUNT(*) as cnt FROM addresses").fetchone()["cnt"]
        pos_count = db.conn.execute("SELECT COUNT(*) as cnt FROM positions").fetchone()["cnt"]

        # Check component health
        ts = c.get("trade_stream")
        ws_healthy = ts.is_healthy if ts else None

        return {
            "status": "ok" if (ws_healthy is None or ws_healthy) else "degraded",
            "uptime_seconds": round(time.time() - start_time, 1),
            "addresses_discovered": addr_count,
            "positions_tracked": pos_count,
            "ws_healthy": ws_healthy,
        }

    @router.get("/v1/heatmap/{coin}")
    def heatmap(coin: str):
        if "liq_heatmap" not in c:
            return JSONResponse(status_code=503, content={"error": "Heatmap engine not available"})
        engine = c["liq_heatmap"]
        result = engine.get_heatmap(coin.upper())
        if not result:
            return JSONResponse(
                status_code=404,
                content={"error": f"No heatmap data for {coin.upper()}", "available": engine.get_available_coins()},
            )
        # Add freshness
        computed = result.get("summary", {}).get("computed_at", 0)
        result["data_age_seconds"] = round(time.time() - computed, 1) if computed else None
        return result

    @router.get("/v1/hlp/positions")
    def hlp_positions():
        if "hlp_tracker" not in c:
            return JSONResponse(status_code=503, content={"error": "HLP tracker not available"})
        tracker = c["hlp_tracker"]
        positions = tracker.get_positions()
        return {
            "positions": positions,
            "count": len(positions),
        }

    @router.get("/v1/hlp/sentiment")
    def hlp_sentiment(hours: float = Query(24, ge=1, le=168)):
        if "hlp_tracker" not in c:
            return JSONResponse(status_code=503, content={"error": "HLP tracker not available"})
        tracker = c["hlp_tracker"]
        return {"sentiment": tracker.get_sentiment(hours), "hours": hours}

    @router.get("/v1/orderflow/{coin}")
    def order_flow(coin: str):
        if "order_flow" not in c:
            return JSONResponse(status_code=503, content={"error": "Order flow engine not available"})
        engine = c["order_flow"]
        result = engine.get_order_flow(coin.upper())
        result["computed_at"] = time.time()
        return result

    @router.get("/v1/whales/{coin}")
    def whales(coin: str, top_n: int = Query(50, ge=1, le=500)):
        if "whale_tracker" not in c:
            return JSONResponse(status_code=503, content={"error": "Whale tracker not available"})
        tracker = c["whale_tracker"]
        result = tracker.get_whales(coin.upper(), top_n)
        # Add freshness — oldest position in result
        positions = result.get("positions", [])
        if positions:
            oldest = min(p.get("updated_at", 0) for p in positions)
            result["oldest_position_age_seconds"] = round(time.time() - oldest, 1)
        return result

    @router.get("/v1/smart-money")
    def smart_money(
        top_n: int = Query(50, ge=1, le=200),
        min_win_rate: float = Query(0, ge=0, le=1),
        style: str = Query(""),
        exclude_bots: bool = Query(False),
        min_trades: int = Query(0, ge=0),
    ):
        if "smart_money" not in c:
            return JSONResponse(status_code=503, content={"error": "Smart money engine not available"})
        engine = c["smart_money"]
        # Fetch extra to compensate for post-filtering
        data = engine.get_rankings(top_n * 3 if (min_win_rate or style or exclude_bots or min_trades) else top_n)
        rankings = data.get("rankings") or []

        style_set = {s.strip() for s in style.split(",") if s.strip()} if style else set()
        filtered = [
            r for r in rankings
            if (not min_win_rate or (r.get("win_rate") or 0) >= min_win_rate)
            and (not style_set or r.get("style", "") in style_set)
            and (not exclude_bots or not r.get("is_bot"))
            and (not min_trades or (r.get("trade_count") or 0) >= min_trades)
        ][:top_n]

        data["rankings"] = filtered
        return data

    @router.get("/v1/stats")
    def stats():
        start_time = c.get("start_time", 0)
        result = {
            "uptime_seconds": round(time.time() - start_time, 1),
            "rate_limiter": c["rate_limiter"].stats(),
        }
        if "trade_stream" in c:
            result["trade_stream"] = c["trade_stream"].stats()
        if "position_poller" in c:
            result["position_poller"] = c["position_poller"].stats()
        if "hlp_tracker" in c:
            result["hlp_tracker"] = c["hlp_tracker"].stats()
        if "liq_heatmap" in c:
            result["liq_heatmap"] = c["liq_heatmap"].stats()
        return result

    # ---- Smart Money: Wallet Tracker ----

    @router.get("/v1/smart-money/watchlist")
    def sm_watchlist():
        profiler = c.get("profiler")
        if not profiler:
            return JSONResponse(status_code=503, content={"error": "Profiler not available"})
        return {"wallets": profiler.get_watchlist()}

    @router.get("/v1/smart-money/wallet/{address}")
    def sm_profile(address: str):
        profiler = c.get("profiler")
        if not profiler:
            return JSONResponse(status_code=503, content={"error": "Profiler not available"})
        profile = profiler.get_profile(address)
        if not profile:
            return JSONResponse(status_code=404, content={"error": "No profile data — insufficient trades"})
        return profile

    @router.get("/v1/smart-money/changes")
    def sm_changes(minutes: int = Query(30, ge=1, le=1440)):
        db = c["db"]
        cutoff = time.time() - minutes * 60
        rows = db.conn.execute(
            """
            SELECT pc.address, pc.coin, pc.action, pc.side, pc.size_usd,
                   pc.price, pc.detected_at,
                   wp.win_rate, wp.style, wp.is_bot,
                   ww.label
            FROM position_changes pc
            LEFT JOIN wallet_profiles wp ON pc.address = wp.address
            LEFT JOIN watched_wallets ww ON pc.address = ww.address AND ww.is_active = 1
            WHERE pc.detected_at > ?
            ORDER BY pc.detected_at DESC
            LIMIT 100
            """,
            (cutoff,),
        ).fetchall()
        return {"changes": [dict(r) for r in rows], "count": len(rows)}

    @router.post("/v1/smart-money/watch")
    def sm_watch(body: dict = Body(...)):
        profiler = c.get("profiler")
        if not profiler:
            return JSONResponse(status_code=503, content={"error": "Profiler not available"})
        address = body.get("address", "").strip().lower()
        if not address or len(address) < 10:
            return JSONResponse(status_code=400, content={"error": "Invalid address"})
        label = body.get("label", "")
        profiler.watch(address, label)
        return {"status": "ok", "address": address, "label": label}

    @router.delete("/v1/smart-money/watch/{address}")
    def sm_unwatch(address: str):
        profiler = c.get("profiler")
        if not profiler:
            return JSONResponse(status_code=503, content={"error": "Profiler not available"})
        address = address.strip().lower()
        profiler.unwatch(address)
        return {"status": "ok", "address": address}

    return router
