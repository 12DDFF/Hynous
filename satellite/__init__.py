"""Satellite: ML feature computation engine for Hynous.

Computes 12 structural core features from data-layer engines,
stores them in a dedicated SQLite database, and provides the
single source of truth for feature computation across training,
inference, and backfill.
"""

import logging

log = logging.getLogger(__name__)

SCHEMA_VERSION = 2


def tick(
    snapshot: object,
    data_layer_db: object,
    heatmap_engine: object | None = None,
    order_flow_engine: object | None = None,
    store: "SatelliteStore | None" = None,
    config: "SatelliteConfig | None" = None,
    candles_map: dict[str, tuple[list, list]] | None = None,  # NEW: {coin: (candles_5m, candles_1m)}
) -> list["FeatureResult"]:
    """Compute and store features for all configured coins.

    Called by the daemon every 300s after _poll_derivatives().

    Args:
        snapshot: Daemon's MarketSnapshot.
        data_layer_db: data-layer Database instance.
        heatmap_engine: LiqHeatmapEngine (optional).
        order_flow_engine: OrderFlowEngine (optional).
        store: SatelliteStore to write results.
        config: SatelliteConfig.

    Returns:
        List of FeatureResult objects (one per coin).
    """
    from satellite.features import compute_features
    from satellite.config import SatelliteConfig

    cfg = config or SatelliteConfig()
    results = []

    for coin in cfg.coins:
        try:
            c5m, c1m = (candles_map or {}).get(coin, (None, None))
            result = compute_features(
                coin=coin,
                snapshot=snapshot,
                data_layer_db=data_layer_db,
                heatmap_engine=heatmap_engine,
                order_flow_engine=order_flow_engine,
                config=cfg,
                candles_5m=c5m,
                candles_1m=c1m,
            )
            if store:
                store.save_snapshot(result)
            results.append(result)
        except Exception:
            log.exception("Satellite tick failed for %s", coin)

    return results
