# WebSocket Migration — Replace REST Polling with Streaming

> **Status:** Phase 1 Implemented (2026-03-14) — Market data WS (`allMids`, `l2Book`, `activeAssetCtx`). Phase 2 Planned — Account data WS.
> **Priority:** High
> **Depends on:** WS price feed (superseded — allMids now part of this migration)

---

## Problem

The daemon makes ~15 distinct REST calls to Hyperliquid per loop cycle. At 1s loop frequency with two VPS instances sharing one IP, this burns through rate limits fast. HTTP 429s cascade across all systems — position tracking goes blind, SL/TP triggers stop firing, and MFE/MAE tracking gaps appear.

The original `allMids` WebSocket feed (formerly in `daemon._run_ws_price_feed()`) proved the pattern works. Phase 1 extended it to a centralized `MarketDataFeed` class in `src/hynous/data/providers/ws_feeds.py` managing multiple channels (`allMids`, `l2Book`, `activeAssetCtx`) on one connection. Phase 2 will add account data channels.

## Core Principle

**REST = we ask for data (rate-limited). WebSocket = they push data to us (no rate limit).**

WS connections stay open. Data flows in real-time as events happen on-chain. No polling, no 429s, no stale caches. The only REST calls that remain are write operations (order placement, cancellation, leverage changes) — these are infrequent and well within rate limits.

---

## Current REST Inventory (18 Distinct Calls)

### Info Class — Market Data (5 calls)

| # | Method | What It Fetches | Call Sites | Frequency |
|---|--------|----------------|------------|-----------|
| 1 | `all_mids()` | Mid prices for all pairs | `_fetch_all_mids()` → daemon `_poll_prices()`, paper `check_triggers()` | Every 1s (WS fallback) |
| 2 | `candles_snapshot()` | OHLCV candle data | daemon `_poll_prices()` (5m), `_update_peaks_from_candles()` (1m), `_fetch_satellite_candles()` (5m+1m) | Every 60s per coin |
| 3 | `l2_snapshot()` | L2 orderbook (20 levels/side) | daemon `_poll_prices()`, briefing `DataCache` | Every 60s |
| 4 | `funding_history()` | Historical funding rates | `tools/funding.py` | On demand |
| 5 | `meta_and_asset_ctxs()` | Universe metadata + asset contexts (funding, OI, volume, mark prices) | daemon `_poll_derivatives()`, `get_multi_asset_contexts()` | Every 300s |

### Info Class — Account Data (5 calls)

| # | Method | What It Fetches | Call Sites | Frequency |
|---|--------|----------------|------------|-----------|
| 6 | `user_state()` | Positions, margins, equity, unrealized PnL | daemon `_fast_trigger_check()`, `_check_positions()`, tools/trading.py | Every 1s + every 60s |
| 7 | `spot_user_state()` | Spot USDC balance (unified margin) | Inside `get_user_state()` | Every 1s + every 60s |
| 8 | `open_orders()` | Resting limit orders | tools/trading.py | On demand |
| 9 | `frontend_open_orders()` | All orders including SL/TP triggers | daemon `_refresh_trigger_cache()`, tools/trading.py | Every trigger check |
| 10 | `user_fills_by_time()` | Trade execution history | daemon `_handle_position_close()`, data-layer profiler | On position close |

### Exchange Class — Write Operations (5 calls)

| # | Method | What It Does | Cannot Be Replaced |
|---|--------|--------------|--------------------|
| 11 | `market_open()` | Open position at market | Must stay REST |
| 12 | `market_close()` | Close position at market | Must stay REST |
| 13 | `order()` | Place limit/trigger orders | Must stay REST |
| 14 | `cancel()` | Cancel an order | Must stay REST |
| 15 | `update_leverage()` | Change symbol leverage | Must stay REST |

### Data Layer (3 calls)

| # | Method | What It Does | Notes |
|---|--------|--------------|-------|
| 16 | `meta()` | Get universe (coin list) | One-time at startup |
| 17 | `subscribe("trades")` | Live trade stream | Already WS |
| 18 | `disconnect_websocket()` | Cleanup | N/A |

---

## Available Hyperliquid WS Channels

Full channel reference from the [Hyperliquid WS docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions):

| Channel | Subscription Format | Data Returned | Update Frequency |
|---------|-------------------|---------------|-----------------|
| `allMids` | `{"type": "allMids"}` | All mid prices | Per block (~0.4s) |
| `l2Book` | `{"type": "l2Book", "coin": "<sym>"}` | Bid/ask levels (price, size, count) | Every 0.5s min |
| `bbo` | `{"type": "bbo", "coin": "<sym>"}` | Best bid/offer only | On change per block |
| `trades` | `{"type": "trades", "coin": "<sym>"}` | Every trade (price, size, side, addresses) | Real-time per trade |
| `candle` | `{"type": "candle", "coin": "<sym>", "interval": "<int>"}` | OHLCV data | Per candle close |
| `activeAssetCtx` | `{"type": "activeAssetCtx", "coin": "<sym>"}` | Day volume, mark price, funding, OI | Real-time |
| `clearinghouseState` | `{"type": "clearinghouseState", "user": "<addr>"}` | Full position/margin/equity state | Real-time on change |
| `openOrders` | `{"type": "openOrders", "user": "<addr>"}` | All open orders including triggers | Real-time on change |
| `orderUpdates` | `{"type": "orderUpdates", "user": "<addr>"}` | Order status changes (filled, cancelled) | Real-time per event |
| `userFills` | `{"type": "userFills", "user": "<addr>"}` | Fills with snapshot on connect | Real-time per fill |
| `userEvents` | `{"type": "userEvents", "user": "<addr>"}` | Fills + funding + liquidations combined | Real-time per event |
| `userFundings` | `{"type": "userFundings", "user": "<addr>"}` | Funding payments | Hourly + streaming |
| `activeAssetData` | `{"type": "activeAssetData", "user": "<addr>", "coin": "<sym>"}` | Leverage, max trade sizes, liquidity | Real-time |
| `webData3` | `{"type": "webData3", "user": "<addr>"}` | Full user state + vault info | Real-time |
| `spotState` | `{"type": "spotState", "user": "<addr>"}` | Spot balances | Real-time |
| `notification` | `{"type": "notification", "user": "<addr>"}` | System notifications | Event-driven |

Supported candle intervals: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, 1d, 3d, 1w, 1M.

Snapshot-based feeds (`userFills`, `userFundings`) include `isSnapshot: true` on initial data, then `isSnapshot: false` for streaming updates. On reconnect, the snapshot provides missed data.

---

## Migration Map: REST → WS

### Phase 1: Account State (Highest Impact)

These eliminate the most frequent REST calls and fix the stale-cache class of bugs entirely.

| REST Call | WS Replacement | Impact |
|-----------|---------------|--------|
| `user_state()` (every 1s) | `clearinghouseState` | Positions update in real-time. No more stale `_prev_positions` after 429s. Fixes root cause of T1 bug class. |
| `frontend_open_orders()` (every trigger check) | `openOrders` | Know instantly when SL/TP fires. `_tracked_triggers` stays permanently fresh — no more stale trigger cache (B1 bug class). |
| `user_fills_by_time()` (on close) | `userFills` | Fills stream in real-time. No more fill detection delay or missed fills. |
| `spot_user_state()` (every 1s) | `spotState` | USDC balance always current. |

### Phase 2: Market Data

| REST Call | WS Replacement | Impact |
|-----------|---------------|--------|
| `all_mids()` | `allMids` | **Already implemented.** Sub-second prices for trigger checks. |
| `candles_snapshot()` (every 60s) | `candle` (per coin + interval) | Candles stream as they close. No more 60s polling delay for MFE candle correction. |
| `l2_snapshot()` (every 60s) | `l2Book` | Orderbook updates every 0.5s. Scanner and briefing get fresher data. |
| `meta_and_asset_ctxs()` (every 300s) | `activeAssetCtx` (per coin) | Funding, OI, volume update in real-time instead of every 5 min. |

### Phase 3: Enhanced Data (New Capabilities)

| WS Channel | What You Gain | Current Gap |
|------------|--------------|-------------|
| `bbo` | Best bid/offer on change only — lighter than full L2 | Currently polling full L2 book |
| `orderUpdates` | Know the instant an SL/TP/limit order fills or cancels | Currently discovering via position state diff |
| `userEvents` | Unified stream of fills + funding + liquidations | Currently separate REST calls |
| `activeAssetData` | Per-user leverage + max trade sizes per coin | Currently only fetched on demand |

### Not Migrated (Write Operations — Must Stay REST)

| Operation | Why |
|-----------|-----|
| `market_open()` | Order execution |
| `market_close()` | Order execution |
| `order()` (limit/trigger) | Order placement |
| `cancel()` | Order cancellation |
| `update_leverage()` | Account mutation |

---

## Architecture Notes

### Implemented Architecture (Phase 1)

WS management moved from daemon to provider layer. `MarketDataFeed` in `ws_feeds.py` manages one WS connection with multiple channel subscriptions. Provider methods check WS cache first (<30s freshness), REST fallback. Daemon starts WS via `provider.start_ws(coins)`.

- Background thread with auto-reconnect (exponential backoff 5→60s)
- Per-channel state dicts (atomically replaced, GIL-safe)
- `get_prices()`, `get_l2_book(coin)`, `get_asset_ctx(coin)` — return `None` if stale
- Provider methods transparently use WS or REST — callers unaware

### Files Modified (Phase 1)

| File | Changes |
|------|---------|
| `src/hynous/data/providers/ws_feeds.py` | **NEW** — `MarketDataFeed` class, 3 channel handlers, reconnect, health |
| `src/hynous/data/providers/hyperliquid.py` | WS-first reads on `get_all_prices`, `get_price`, `get_l2_book`, `get_asset_context`, `get_multi_asset_contexts`; `start_ws`/`stop_ws`/`ws_health` |
| `src/hynous/data/providers/paper.py` | 3 passthrough methods (`start_ws`, `stop_ws`, `ws_health`) |
| `src/hynous/intelligence/daemon.py` | Removed `_run_ws_price_feed`, `_get_prices_with_ws_fallback`, WS state vars; added `_update_ws_coins`, provider-based WS startup |
| `tests/unit/test_ws_price_feed.py` | 49 tests covering all WS interfaces |

### Connection Strategy

Options:
1. **Single WS connection, multiple subscriptions** — fewer connections, but one disconnect kills everything
2. **Grouped connections** — market data on one connection, account data on another. A market data disconnect doesn't affect position tracking.
3. **Per-channel connections** — maximum isolation, but more sockets. Likely overkill.

Recommendation: **Two connections** — one for market data (`allMids`, `l2Book`, `candle`, `activeAssetCtx`), one for account data (`clearinghouseState`, `openOrders`, `userFills`, `orderUpdates`). Account data is critical-path; market data is enhancement.

### Paper Provider Considerations

`PaperProvider` delegates all price reads to mainnet HTTP via the real `HyperliquidProvider`. With WS migration, the paper provider should consume WS-fed prices from the daemon rather than making its own REST calls. This is how `_fast_trigger_check()` already works — it passes `fresh_prices` to `check_triggers()`.

---

## Benefits Summary

| Metric | Before (REST) | After (WS) |
|--------|-------------|------------|
| Price freshness | 1s polling | Sub-second streaming |
| Position state freshness | 1s polling, stale on 429 | Real-time, immune to 429 |
| Trigger order state | 300s cache + manual refresh | Real-time streaming |
| Fill detection | Polling + snapshot diff | Instant streaming |
| 429 risk (reads) | High — 15+ calls/loop | Zero — WS has no rate limit |
| 429 risk (total) | High | Minimal — only write operations |
| Dual-instance impact | Doubles 429 risk | No impact — separate WS connections |
| MFE accuracy | 1s sampling + 60s candle correction | Sub-second + candle on close |
| Reconnect data gap | Must re-poll everything | Snapshot on reconnect fills gaps |

---

## Open Questions (Resolved)

1. **Thread model:** Single manager thread per connection, dispatching to channel handlers via `on_message`. ✅
2. **State consistency:** Atomic dict replacement (GIL-safe). Each channel has independent staleness tracking. ✅
3. **Testing:** 49 unit tests using source inspection + direct state injection. No WS mocking needed. ✅
4. **Gradual rollout:** Phase 1 (market data) shipped first. Phase 2 (account data) deferred to live trading. ✅
5. **Data layer integration:** Separate concern — data-layer already has its own WS (trade_stream, l2_subscriber). Not affected. ✅

## Open Questions (Phase 2)

1. **Account data WS endpoint:** Mainnet vs testnet — `_trade_info` may point to a different server.
2. **`clearinghouseState` in paper mode:** Paper positions don't exist on-chain. Account WS only useful for live.
3. **`_refresh_trigger_cache()` elimination:** 13 manual call sites can be deleted once `openOrders` WS feeds `_tracked_triggers` automatically.

---

## References

- [Hyperliquid WS Subscriptions Docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions)
- [Python SDK WebSocket Manager](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/websocket_manager.py)
- Implementation: `src/hynous/data/providers/ws_feeds.py` (MarketDataFeed class)
- Implementation guide: `docs/revisions/ws-migration/implementation-guide.md`
- Superseded revision: `docs/revisions/ws-price-feed/` (allMids-only WS — now part of this migration)

---

Last updated: 2026-03-14
