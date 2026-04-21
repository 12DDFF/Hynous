# Data Module

> Market data providers and execution layer -- Hynous's connection to
> the outside world.

---

## Structure

```
data/
├── providers/
│   ├── hyperliquid.py     # Exchange data + order execution (Hyperliquid SDK, WS-first reads)
│   ├── paper.py           # Paper trading simulator (wraps HyperliquidProvider)
│   ├── ws_feeds.py        # WebSocket feed manager (allMids, l2Book, activeAssetCtx, candle 1m/5m)
│   ├── coinglass.py       # Cross-exchange derivatives data (Coinglass API v4)
│   ├── hynous_data.py     # HTTP client for hynous-data service (liquidations, whales, order flow)
│   └── __init__.py
└── __init__.py
```

v2 note: `cryptocompare.py`, `perplexity.py`, and the related news /
web-search agent tools were removed in phase 7 M7.

---

## Providers

All providers follow the singleton pattern via a module-level
`get_provider()` (or `get_client()`) function. REST methods are
synchronous, using `requests.Session` for connection reuse. Market data
reads (`get_all_prices`, `get_l2_book`, `get_asset_context`,
`get_multi_asset_contexts`) are WS-first with REST fallback -- managed
by `MarketDataFeed` in `ws_feeds.py`.

### HyperliquidProvider (`hyperliquid.py`)

The primary provider. Wraps the Hyperliquid Python SDK for both market
data reads (always mainnet) and order execution (mainnet, testnet, or
paper mode). Market data reads are WS-first (via `MarketDataFeed` in
`ws_feeds.py`) with REST fallback if WS is stale (>30s). Write
operations always use REST.

**Market Data Methods:**

| Method | Returns |
|--------|---------|
| `get_price(symbol)` | Current mid price for one symbol |
| `get_all_prices()` | All mid prices `{symbol: float}` |
| `get_candles(symbol, interval, start_ms, end_ms)` | OHLCV candle list |
| `get_l2_book(symbol)` | L2 orderbook snapshot (20 levels/side, spread, mid) |
| `get_funding_history(symbol, start_ms, end_ms)` | Historical funding rates |
| `get_asset_context(symbol)` | Funding, OI, volume, mark price for one symbol |
| `get_multi_asset_contexts(symbols)` | Same as above, batched (single API call) |
| `get_all_asset_contexts()` | Context for every trading pair (used by market scanner) |

**Account Methods** (require wallet):

| Method | Returns |
|--------|---------|
| `get_user_state()` | Account value, margin, withdrawable, unrealized PnL, positions |
| `get_open_orders()` | Resting limit orders |
| `get_trigger_orders(symbol?)` | Stop loss / take profit trigger orders |
| `get_user_fills(start_ms, end_ms?)` | Trade fill history |

**Trading Methods** (require exchange initialization via private key):

| Method | Description |
|--------|-------------|
| `market_open(symbol, is_buy, size_usd, slippage)` | Market order (aggressive IoC limit) |
| `market_close(symbol, size?, slippage)` | Close position (full or partial) |
| `limit_open(symbol, is_buy, limit_px, size_usd/sz, tif)` | Limit order (GTC, ALO, or IOC) |
| `place_trigger_order(symbol, is_buy, sz, trigger_px, tpsl)` | Stop loss or take profit |
| `cancel_order(symbol, oid)` | Cancel single order |
| `cancel_all_orders(symbol)` | Cancel all orders for a symbol |
| `update_leverage(symbol, leverage, is_cross)` | Set leverage for a symbol |

**Configuration:**

- Mode is controlled by `config.execution.mode`: `"paper"`, `"testnet"`, or `"live"`
- Private key: `HYPERLIQUID_PRIVATE_KEY` env var
- Data reads always use mainnet regardless of mode
- Market data reads use WS-first (`ws_feeds.py`) with REST fallback (30s staleness threshold on all 4 channels)
- Candle data (1m/5m) also WS-fed via rolling deques; satellite reads via `feed.get_candles()` with REST fallback
- `start_ws(coins)` called by daemon on startup; `stop_ws()` on shutdown
- Exchange is lazily initialized only when a private key is available

**Singleton:** `get_provider(config)` returns `PaperProvider` (paper mode)
or `HyperliquidProvider` (testnet/live).

---

### PaperProvider (`paper.py`)

Drop-in replacement for `HyperliquidProvider` that simulates all trading
operations internally while delegating all market data reads to mainnet.

- Uses real mainnet prices for accurate PnL math
- Simulates margin, leverage, liquidation prices, taker fees (0.035%)
- Supports SL/TP trigger orders (checked by daemon each price poll via `check_triggers()`)
- Persists state to `storage/paper-state.json` (survives restarts)
- `reset_paper_stats()` marks a new session boundary for stats filtering

All data methods (`get_price`, `get_candles`, `get_l2_book`, etc.) pass
through to the real `HyperliquidProvider`. WS methods (`start_ws`,
`stop_ws`, `ws_health`) also pass through.

---

### CoinglassProvider (`coinglass.py`)

Cross-exchange derivatives data from the Coinglass API v4.

| Method | Data |
|--------|------|
| `get_liquidation_coins()` | Aggregate liquidation stats across all coins (1h/4h/12h/24h) |
| `get_liquidation_by_exchange(symbol, range)` | Per-exchange liquidation breakdown |
| `get_oi_by_exchange(symbol)` | Cross-exchange open interest with % changes |
| `get_oi_history_chart(symbol, range)` | OI over time by exchange |
| `get_funding_by_exchange(symbol)` | Current funding rates across exchanges |
| `get_funding_history_weighted(symbol, weight, interval, limit)` | OI/volume-weighted funding OHLC history |
| `get_options_max_pain(symbol, exchange)` | Options max pain per expiry |
| `get_options_info(symbol, exchange)` | Options OI, volume, market share by exchange |
| `get_coinbase_premium(interval, limit)` | Coinbase premium/discount index over time |
| `get_etf_flows(asset)` | Daily BTC/ETH ETF net flows |
| `get_exchange_balance(symbol)` | Per-exchange on-chain holdings with 1d/7d/30d changes |
| `get_fear_greed()` | Fear & Greed index history |

**Configuration:** `COINGLASS_API_KEY` environment variable (required).

---

### HynousDataClient (`hynous_data.py`)

HTTP client for the `hynous-data` service running on `:8100`. Provides
data that requires persistent state or specialized scrapers.

| Method | Data |
|--------|------|
| `heatmap(coin)` / `heatmap_summary(coin)` | Liquidation heatmap (buckets, densest zones) |
| `hlp_positions()` / `hlp_summary()` | HLP vault positions (top by size) |
| `hlp_sentiment(hours)` | HLP sentiment (side flips, deltas) |
| `order_flow(coin)` / `order_flow_summary(coin)` | CVD / order flow by time window (now includes 30m + large-trade count per Amendment 10) |
| `whales(coin, top_n)` / `whale_summary(coin)` | Largest positions (net bias, long/short USD) |
| `smart_money(top_n, min_win_rate, style, ...)` | Most profitable traders with filters |
| `sm_watchlist()` / `sm_watch()` / `sm_unwatch()` | Smart money wallet tracker CRUD |
| `sm_profile(address, days)` / `sm_trades(address, limit)` | Individual wallet profiles and trades |
| `sm_changes(minutes)` | Recent wallet position changes (action-key: entry/flip/increase) |
| `sm_create_alert()` / `sm_list_alerts()` / `sm_delete_alert()` | Wallet alert management |
| `record_historical(funding, oi, volume)` | Record snapshot data to historical tables |
| `health()` / `stats()` | Service health and statistics |

All methods return `None` on connection failure (graceful degradation).
The `is_available` property tracks reachability.

**Configuration:** `data_layer.url` and `data_layer.timeout` in
`config/default.yaml` (default: `http://127.0.0.1:8100`, 5s timeout).

---

## Adding a New Provider

1. Create `providers/my_provider.py` with a class and `get_provider()` singleton
2. Export in `providers/__init__.py` if needed
3. If the data should be agent-accessible, create a tool in `intelligence/tools/`
4. Register the tool in `intelligence/tools/registry.py`
5. Add tool strategy guidance in `src/hynous/user_chat/prompt.py` if the tool is user-chat-invocable (analysis agent does not call external tools).

---

Last updated: 2026-04-12 (phase 7 complete)
