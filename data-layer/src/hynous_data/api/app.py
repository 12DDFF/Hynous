"""FastAPI application factory."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from hynous_data.api.routes import create_router

log = logging.getLogger(__name__)


def create_app(components: dict) -> FastAPI:
    """Create the FastAPI application with all routes.

    Args:
        components: Dict of initialized components (db, engines, collectors, etc.)
    """

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        # Graceful shutdown — stop all components
        log.info("API shutting down — stopping components...")
        for name in ("trade_stream", "position_poller", "hlp_tracker", "liq_heatmap"):
            comp = components.get(name)
            if comp and hasattr(comp, "stop"):
                try:
                    comp.stop()
                    log.info("Stopped %s", name)
                except Exception:
                    log.exception("Error stopping %s", name)
        db = components.get("db")
        if db and hasattr(db, "close"):
            db.close()
            log.info("Database closed")

    app = FastAPI(
        title="Hynous Data Layer",
        description="Hyperliquid market intelligence — heatmaps, order flow, whales",
        version="0.1.0",
        lifespan=lifespan,
    )
    router = create_router(components)
    app.include_router(router)
    return app
