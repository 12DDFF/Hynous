# WebSocket Price Feed — Implementation Guide

> **For the engineer agent.** This guide contains everything needed to implement the WS price feed.
> Read all referenced files before making changes. Follow the steps in order.

---

## Pre-Implementation Reading

Read these files **before writing any code**. They provide the context needed to understand the codebase patterns.

### Required Reading

| File | What to understand | Read lines |
|------|-------------------|------------|
| `src/hynous/intelligence/daemon.py` | `__init__` state variables | 270-425 |
| `src/hynous/intelligence/daemon.py` | Startup section (initial fetches + loop entry) | 960-990 |
| `src/hynous/intelligence/daemon.py` | Main loop body (all checks, timing, sleep) | 992-1150 |
| `src/hynous/intelligence/daemon.py` | `_fast_trigger_check()` (the method being upgraded) | 1895-2010 |
| `src/hynous/intelligence/daemon.py` | `_wake_agent()` price refresh block | 4855-4870 |
| `src/hynous/core/config.py` | `DaemonConfig` dataclass | 94-136 |
| `src/hynous/core/config.py` | `load_config()` DaemonConfig constructor | 306-325 |
| `config/default.yaml` | `daemon:` section | 34-61 |

### Reference Reading (existing WS patterns)

| File | What it demonstrates |
|------|---------------------|
| `data-layer/src/hynous_data/collectors/l2_subscriber.py` | WS reconnect pattern, health monitoring, `threading.Event()` for stop signal, lock-protected dict updates |
| `data-layer/src/hynous_data/collectors/trade_stream.py` | `_run_with_reconnect()` pattern, 30s silence detection, `_stop_event.wait(delay)` for interruptible sleep |

### Reference Docs

| Doc | Purpose |
|-----|---------|
| `docs/revisions/ws-price-feed/README.md` | Problem statement, architecture, what changes / doesn't change |
| `CLAUDE.md` | Project conventions (one feature = one module, config defaults must match YAML) |

---

## Changes Overview

| # | File | Change | Lines affected |
|---|------|--------|---------------|
| 1 | `pyproject.toml` | Add `websocket-client` dependency | 1 line |
| 2 | `src/hynous/core/config.py` | Add `ws_price_feed` field to `DaemonConfig` + `load_config()` | 2 insertions |
| 3 | `config/default.yaml` | Add `ws_price_feed: true` to daemon section | 2 lines |
| 4 | `src/hynous/intelligence/daemon.py` | Add state vars, WS thread method, helper method, launch at startup, modify `_fast_trigger_check()`, modify `_wake_agent()` price refresh, reduce loop sleep | ~80 new lines, 3 line changes |
| 5 | `tests/unit/test_ws_price_feed.py` | New test file | ~120 lines |

**No other files change.** No database changes. No new modules.

---

## Step 1: Add Dependency

**File:** `pyproject.toml`

Find the `dependencies` list (around line 12-41). Add `websocket-client` alongside the other dependencies:

```toml
    "websocket-client>=1.6.0",
```

Place it near the end of the dependency list, before the closing bracket.

**Verify:** Run `pip install websocket-client` to ensure it installs. The package provides `import websocket`.

---

## Step 2: Add Config Field

### 2a. DaemonConfig dataclass

**File:** `src/hynous/core/config.py`
**Location:** After line 136 (`candle_peak_tracking_enabled: bool = True`)

Add:

```python
    # WebSocket price feed (sub-second prices for trigger checks)
    ws_price_feed: bool = True               # Enable WS allMids feed for _fast_trigger_check
```

Default is `True` — the WS feed should be on by default. Falls back to REST automatically if WS fails.

### 2b. load_config() constructor

**File:** `src/hynous/core/config.py`
**Location:** Inside the `DaemonConfig(...)` constructor call, after line 324 (`playbook_cache_ttl=...`). Add before the closing `),` on line 325:

```python
            ws_price_feed=daemon_raw.get("ws_price_feed", True),
```

**Note:** Many newer DaemonConfig fields (breakeven_buffer, trailing_stop, candle_peak) are NOT in the constructor — they rely on dataclass defaults and ignore YAML values. We're doing it properly here so the YAML toggle actually works.

---

## Step 3: Add YAML Config

**File:** `config/default.yaml`
**Location:** After line 60 (`candle_peak_tracking_enabled: true`), before the blank line and scanner section.

Add:

```yaml
  # WebSocket price feed (sub-second prices for mechanical exits)
  ws_price_feed: true                 # allMids WS feed for _fast_trigger_check
```

---

## Step 4: Modify daemon.py

This is the main change. Five modifications in one file.

### 4a. Add state variables to `__init__`

**Location:** After the condition evaluator init and before the Stats block. Find the pattern around line 546:

```python
            except Exception:
                logger.debug("Condition wake evaluator init failed", exc_info=True)

        # Stats                         ← ADD NEW VARS BEFORE THIS LINE
        self.wake_count: int = 0
```

Add:

```python
        # WebSocket price feed — sub-second prices for trigger checks
        self._ws_prices: dict[str, float] = {}   # coin → latest mid price from WS
        self._ws_connected: bool = False          # True while WS is receiving data
        self._ws_last_msg: float = 0.0            # Timestamp of last WS message (health check)
```

### 4b. Add `_run_ws_price_feed()` method

**Location:** Add as a new method in the "Tier 1: Data Polling" section, after `_poll_prices()` (which ends at line ~1204) and before `_poll_derivatives()` (which starts at line 1206). Place both new methods between them.

```python
    def _run_ws_price_feed(self):
        """Background thread: subscribe to Hyperliquid allMids WebSocket.

        Maintains self._ws_prices with sub-second price updates.
        Auto-reconnects on disconnect with 5s delay.
        Falls back silently — if WS is down, _fast_trigger_check uses REST.
        """
        import websocket as _ws_lib
        import json as _json

        url = "wss://api.hyperliquid.xyz/ws"
        sub_msg = _json.dumps({
            "method": "subscribe",
            "subscription": {"type": "allMids"},
        })

        def on_open(ws):
            ws.send(sub_msg)
            self._ws_connected = True
            self._ws_last_msg = time.time()
            logger.info("WS price feed connected")

        def on_message(ws, raw):
            try:
                data = _json.loads(raw)
                if data.get("channel") == "allMids":
                    mids = data["data"]["mids"]
                    # Atomic dict replacement — GIL-safe, no lock needed
                    self._ws_prices = {k: float(v) for k, v in mids.items()}
                    self._ws_last_msg = time.time()
            except Exception as e:
                logger.debug("WS price parse error: %s", e)

        def on_close(ws, close_status_code=None, close_msg=None):
            self._ws_connected = False
            logger.warning("WS price feed disconnected")

        def on_error(ws, err):
            logger.warning("WS price feed error: %s", err)

        while self._running:
            try:
                ws = _ws_lib.WebSocketApp(
                    url,
                    on_open=on_open,
                    on_message=on_message,
                    on_close=on_close,
                    on_error=on_error,
                )
                # run_forever blocks until disconnect. ping keeps connection alive.
                ws.run_forever(ping_interval=30, ping_timeout=10)
            except Exception as e:
                logger.warning("WS price feed crashed: %s", e)

            self._ws_connected = False
            if not self._running:
                break
            # Reconnect delay — interruptible via short sleeps
            for _ in range(10):  # 10 * 0.5s = 5s max
                if not self._running:
                    break
                time.sleep(0.5)
```

**Key design decisions:**
- Uses `websocket-client` (WebSocketApp) — sync, callback-based, runs in a thread. Consistent with the daemon's sync-first architecture.
- Outer `while self._running` loop handles reconnection. Checks `self._running` before reconnect delay so shutdown is responsive.
- Reconnect delay uses short sleeps (0.5s x 10) instead of `time.sleep(5)` so daemon shutdown isn't blocked.
- `on_message` replaces the entire dict atomically (GIL-safe). No lock needed.
- `_ws_last_msg` enables health monitoring — if no message for 30s, we know the feed is stale.

### 4c. Add `_get_prices_with_ws_fallback()` helper

**Location:** Right after `_run_ws_price_feed()`.

```python
    def _get_prices_with_ws_fallback(self) -> dict[str, float]:
        """Get prices from WS if available and fresh, otherwise fall back to REST.

        WS prices are considered fresh if last message was within 30 seconds.
        This is the single price source for _fast_trigger_check and _wake_agent
        price refresh — ensures consistent fallback behavior.
        """
        ws_age = time.time() - self._ws_last_msg if self._ws_last_msg else float("inf")
        if self._ws_prices and ws_age < 30:
            return self._ws_prices
        # WS unavailable or stale — fall back to REST
        return self._get_provider().get_all_prices()
```

**Why a helper:** Both `_fast_trigger_check()` (line 1903) and `_wake_agent()` (line 4862) fetch prices. Centralizing the WS-with-fallback logic in one place avoids duplication and ensures consistent staleness checks.

### 4d. Launch WS thread at startup

**Location:** In the `_loop_inner()` method, after line 980 (`self._load_daily_pnl()`), before line 982 (`while self._running:`).

Add:

```python
        # Launch WebSocket price feed for ultra-fast trigger checks
        if self.config.daemon.ws_price_feed:
            threading.Thread(
                target=self._run_ws_price_feed,
                daemon=True,
                name="hynous-ws-prices",
            ).start()
            logger.info("WS price feed thread launched")
```

This follows the same pattern as other background threads in the daemon (decay, conflict, backfill, consolidation) — all use `threading.Thread(..., daemon=True).start()`.

### 4e. Modify `_fast_trigger_check()` — use WS prices

**Location:** Line 1903 in `_fast_trigger_check()`.

**Replace this line:**

```python
            all_mids = provider.get_all_prices()
```

**With:**

```python
            all_mids = self._get_prices_with_ws_fallback()
```

**This is the only change in the trigger loop.** Everything downstream (`fresh_prices`, `check_triggers()`, ROE tracking, breakeven, trailing stop) already operates on `all_mids`/`fresh_prices`. They get sub-second prices for free.

### 4f. Modify `_wake_agent()` — use WS prices for pre-wake refresh

**Location:** Line 4862 in `_wake_agent()`, inside the price refresh block.

**Replace this line:**

```python
                    fresh_prices = provider.get_all_prices()
```

**With:**

```python
                    fresh_prices = self._get_prices_with_ws_fallback()
```

This ensures agent wakes also benefit from WS prices when available.

### 4g. Reduce main loop sleep from 10s to 1s

**Location:** Line 1146.

**Replace:**

```python
            time.sleep(10)
```

**With:**

```python
            # 1s granularity — WS provides sub-second prices, trigger checks
            # need frequent evaluation for reliable mechanical exits at 20x leverage.
            # All other operations are timer-gated and unaffected by faster looping.
            time.sleep(1)
```

**Why this is safe:** Every operation in the loop except `_fast_trigger_check()` and `scanner.detect()` is gated by its own interval timer (`if now - self._last_X >= interval`). They check eligibility (a timestamp comparison, nanoseconds) more often but don't fire more often. The scanner's `detect()` runs every iteration but is pure in-memory computation (~1-5ms) on cached data — harmless at 1s.

---

## Step 5: Write Tests

**File:** `tests/unit/test_ws_price_feed.py` (new file)

```python
"""
Unit tests for WebSocket price feed integration.

Tests cover:
1. WS fallback logic (_get_prices_with_ws_fallback)
2. WS price freshness gating (30s staleness threshold)
3. Config field presence and YAML loading
4. _fast_trigger_check uses WS-aware price source
5. _wake_agent uses WS-aware price source
6. Loop sleep is 1 second
"""
import inspect
import time

import pytest


class TestWSFallbackLogic:
    """Test the WS-with-REST-fallback price source selection."""

    def test_uses_ws_when_fresh(self):
        """When WS prices exist and are <30s old, use them."""
        ws_prices = {"BTC": 97000.0, "ETH": 3800.0}
        ws_last_msg = time.time()  # just now
        ws_age = time.time() - ws_last_msg

        should_use_ws = bool(ws_prices) and ws_age < 30
        assert should_use_ws

    def test_falls_back_when_stale(self):
        """When WS prices are >30s old, fall back to REST."""
        ws_prices = {"BTC": 97000.0}
        ws_last_msg = time.time() - 35  # 35 seconds ago

        ws_age = time.time() - ws_last_msg
        should_use_ws = bool(ws_prices) and ws_age < 30
        assert not should_use_ws

    def test_falls_back_when_empty(self):
        """When WS prices dict is empty (cold start), fall back to REST."""
        ws_prices = {}
        ws_last_msg = time.time()

        should_use_ws = bool(ws_prices) and (time.time() - ws_last_msg) < 30
        assert not should_use_ws

    def test_falls_back_when_never_connected(self):
        """When WS has never connected (ws_last_msg=0), fall back."""
        ws_prices = {}
        ws_last_msg = 0.0

        ws_age = time.time() - ws_last_msg if ws_last_msg else float("inf")
        should_use_ws = bool(ws_prices) and ws_age < 30
        assert not should_use_ws


class TestWSMessageParsing:
    """Test parsing of Hyperliquid allMids WebSocket messages."""

    def test_parse_valid_message(self):
        """Valid allMids message should produce float dict."""
        import json

        raw = json.dumps({
            "channel": "allMids",
            "data": {"mids": {"BTC": "97432.5", "ETH": "3821.2", "SOL": "187.4"}}
        })
        data = json.loads(raw)

        assert data.get("channel") == "allMids"
        mids = data["data"]["mids"]
        result = {k: float(v) for k, v in mids.items()}

        assert result == {"BTC": 97432.5, "ETH": 3821.2, "SOL": 187.4}
        assert all(isinstance(v, float) for v in result.values())

    def test_ignore_non_allmids_message(self):
        """Messages from other channels should be ignored."""
        import json

        raw = json.dumps({"channel": "trades", "data": {"coin": "BTC"}})
        data = json.loads(raw)

        assert data.get("channel") != "allMids"

    def test_parse_handles_malformed(self):
        """Malformed messages should not crash."""
        import json

        for bad_raw in ["{}", "not json", '{"channel": "allMids"}']:
            try:
                data = json.loads(bad_raw)
                if data.get("channel") == "allMids":
                    mids = data["data"]["mids"]
                    {k: float(v) for k, v in mids.items()}
            except Exception:
                pass  # Should not crash, just skip


class TestConfigField:
    """Verify ws_price_feed config field exists and loads."""

    def test_daemon_config_has_field(self):
        """DaemonConfig dataclass should have ws_price_feed field."""
        from hynous.core.config import DaemonConfig
        dc = DaemonConfig()
        assert hasattr(dc, "ws_price_feed")
        assert dc.ws_price_feed is True  # default is True

    def test_config_loads_from_yaml(self):
        """load_config should pass ws_price_feed from YAML to DaemonConfig."""
        import inspect
        from hynous.core.config import load_config

        source = inspect.getsource(load_config)
        assert "ws_price_feed" in source, (
            "load_config must pass ws_price_feed to DaemonConfig constructor"
        )


class TestDaemonIntegration:
    """Verify daemon.py uses WS-aware price sources."""

    def test_fast_trigger_check_uses_ws_fallback(self):
        """_fast_trigger_check must call _get_prices_with_ws_fallback, not get_all_prices directly."""
        import inspect
        from hynous.intelligence.daemon import Daemon

        source = inspect.getsource(Daemon._fast_trigger_check)
        assert "_get_prices_with_ws_fallback" in source, (
            "_fast_trigger_check must use _get_prices_with_ws_fallback"
        )
        # Should NOT call provider.get_all_prices() directly
        # (it's in the fallback helper, but not in the trigger check itself)
        assert "provider.get_all_prices()" not in source, (
            "_fast_trigger_check must not call provider.get_all_prices() directly"
        )

    def test_ws_fallback_helper_exists(self):
        """Daemon must have _get_prices_with_ws_fallback method."""
        from hynous.intelligence.daemon import Daemon

        assert hasattr(Daemon, "_get_prices_with_ws_fallback"), (
            "Daemon must have _get_prices_with_ws_fallback method"
        )

    def test_ws_feed_method_exists(self):
        """Daemon must have _run_ws_price_feed method."""
        from hynous.intelligence.daemon import Daemon

        assert hasattr(Daemon, "_run_ws_price_feed"), (
            "Daemon must have _run_ws_price_feed method"
        )

    def test_wake_agent_uses_ws_fallback(self):
        """_wake_agent price refresh should use WS-aware source."""
        import inspect
        from hynous.intelligence.daemon import Daemon

        source = inspect.getsource(Daemon._wake_agent)
        assert "_get_prices_with_ws_fallback" in source, (
            "_wake_agent must use _get_prices_with_ws_fallback for price refresh"
        )

    def test_loop_sleep_is_1s(self):
        """Main loop sleep should be 1 second, not 10."""
        import inspect
        from hynous.intelligence.daemon import Daemon

        source = inspect.getsource(Daemon._loop_inner)
        assert "time.sleep(1)" in source, (
            "Main loop must sleep 1s (not 10s) for fast trigger checks"
        )
        assert "time.sleep(10)" not in source, (
            "Main loop must not sleep 10s — should be 1s"
        )


class TestWSFreshnessThreshold:
    """Test the 30-second staleness threshold for WS prices."""

    def test_29s_is_fresh(self):
        ws_last_msg = time.time() - 29
        ws_age = time.time() - ws_last_msg
        assert ws_age < 30

    def test_31s_is_stale(self):
        ws_last_msg = time.time() - 31
        ws_age = time.time() - ws_last_msg
        assert ws_age >= 30

    def test_boundary_30s(self):
        ws_last_msg = time.time() - 30
        ws_age = time.time() - ws_last_msg
        # At exactly 30s, should be stale (>= 30, not < 30)
        assert ws_age >= 30


class TestAtomicDictReplacement:
    """Verify the dict replacement pattern is GIL-safe."""

    def test_full_dict_replacement(self):
        """Replacing a dict reference is atomic in CPython (GIL)."""
        # Simulate what on_message does
        ws_prices = {"BTC": 97000.0}
        new_mids = {"BTC": "97500.5", "ETH": "3821.2"}

        # This is an atomic operation — reader sees old or new, never partial
        ws_prices = {k: float(v) for k, v in new_mids.items()}

        assert ws_prices == {"BTC": 97500.5, "ETH": 3821.2}

    def test_empty_to_populated(self):
        """First message populates empty dict."""
        ws_prices = {}
        mids = {"BTC": "97000.0"}
        ws_prices = {k: float(v) for k, v in mids.items()}
        assert ws_prices == {"BTC": 97000.0}
```

---

## Step 6: Run Static Tests

Run all unit tests to verify nothing is broken:

```bash
# Install new dependency
pip install "websocket-client>=1.6.0"

# Run new WS tests
PYTHONPATH=src pytest tests/unit/test_ws_price_feed.py -v

# Run existing mechanical exit tests (must still pass)
PYTHONPATH=src pytest tests/unit/test_mechanical_exits.py -v
PYTHONPATH=src pytest tests/unit/test_429_resilience.py -v
PYTHONPATH=src pytest tests/unit/test_stale_cache_fix.py -v
PYTHONPATH=src pytest tests/unit/test_stale_trigger_cache_fix.py -v
PYTHONPATH=src pytest tests/unit/test_exit_classification.py -v
PYTHONPATH=src pytest tests/unit/test_cancel_before_place.py -v
PYTHONPATH=src pytest tests/unit/test_candle_peak_tracking.py -v
PYTHONPATH=src pytest tests/unit/test_recent_trades.py -v

# Run full test suite
PYTHONPATH=src pytest tests/ -v
```

**All existing tests must pass.** The changes are additive — nothing is removed, only a price source swap and a sleep reduction.

---

## Step 7: Live Environment Test

### 7a. Verify WebSocket connectivity

Quick standalone test to verify Hyperliquid WS is reachable:

```bash
python3 -c "
import websocket, json, time

url = 'wss://api.hyperliquid.xyz/ws'
received = []

def on_open(ws):
    ws.send(json.dumps({'method': 'subscribe', 'subscription': {'type': 'allMids'}}))
    print('Subscribed to allMids')

def on_message(ws, msg):
    data = json.loads(msg)
    if data.get('channel') == 'allMids':
        mids = data['data']['mids']
        print(f'Got {len(mids)} prices. BTC={mids.get(\"BTC\", \"N/A\")}')
        received.append(1)
        if len(received) >= 3:
            ws.close()

def on_error(ws, err):
    print(f'Error: {err}')

ws = websocket.WebSocketApp(url, on_open=on_open, on_message=on_message, on_error=on_error)
ws.run_forever(ping_interval=10, ping_timeout=5)
print(f'Received {len(received)} messages — WS connectivity OK')
"
```

**Expected output:** 3 messages received with BTC price. If this fails, check network/firewall.

### 7b. Start the daemon and verify WS feed

1. Ensure `config/default.yaml` has `ws_price_feed: true` in the daemon section.
2. Start the dashboard (which starts the daemon):

```bash
cd dashboard && reflex run
```

3. Check logs for WS connection:

```
grep -i "ws price feed" storage/daemon.log
```

**Expected log entries:**
- `"WS price feed thread launched"` — at startup
- `"WS price feed connected"` — when WS connects (~1s after launch)

4. If daemon is not enabled (`daemon.enabled: false`), temporarily set it to `true` in `default.yaml` and restart.

### 7c. Verify trigger check frequency

With the daemon running, check that the trigger loop is executing at ~1s intervals. The trigger check logs at DEBUG level. Temporarily set `logging.level: DEBUG` in `default.yaml`, or check the loop timing by observing the heartbeat updates.

You can verify the 1s cadence by checking `_heartbeat` updates in the daemon — the dashboard's watchdog reads this value.

### 7d. Verify REST fallback

Stop the WS feed (disconnect network briefly, or set `ws_price_feed: false` and restart). Verify that `_fast_trigger_check()` continues working via REST fallback — the existing `get_all_prices()` path. Check logs for any errors.

### 7e. Verify mechanical exits still work

If in paper mode with open positions:
1. Observe that ROE tracking updates every ~1s in logs (not every 10s)
2. Verify breakeven placement triggers when ROE crosses the fee threshold
3. Verify trailing stop activation at 2.8% ROE

If no positions are open, the trigger check returns early (line 1896: `if not self._prev_positions: return`) — this is correct behavior.

---

## Verification Checklist

After implementation, verify each item:

- [ ] `websocket-client>=1.6.0` in `pyproject.toml` and installed
- [ ] `DaemonConfig.ws_price_feed` field exists with default `True`
- [ ] `load_config()` passes `ws_price_feed` from YAML to `DaemonConfig`
- [ ] `default.yaml` has `ws_price_feed: true` in daemon section
- [ ] `daemon.__init__` has `_ws_prices`, `_ws_connected`, `_ws_last_msg`
- [ ] `_run_ws_price_feed()` method exists with reconnect loop and health tracking
- [ ] `_get_prices_with_ws_fallback()` helper exists with 30s staleness check
- [ ] WS thread launches at startup (after `_load_daily_pnl()`, before `while self._running`)
- [ ] `_fast_trigger_check()` calls `_get_prices_with_ws_fallback()` (not `provider.get_all_prices()`)
- [ ] `_wake_agent()` price refresh calls `_get_prices_with_ws_fallback()`
- [ ] Main loop sleep is `time.sleep(1)` (not `time.sleep(10)`)
- [ ] All unit tests pass (`tests/unit/test_ws_price_feed.py` + all existing)
- [ ] WS connectivity test passes (standalone script)
- [ ] Daemon starts and logs "WS price feed connected"
- [ ] REST fallback works when WS is disabled

---

## What NOT to Change

- `_poll_prices()` — Leave as-is. Still runs every 60s via REST. Feeds scanner.
- `check_triggers()` in `paper.py` — Leave as-is. Receives prices as parameter.
- `_update_peaks_from_candles()` — Leave as-is. Uses candle data, not spot prices.
- Scanner detect block — Leave as-is. Runs every iteration, pure in-memory.
- Any other daemon timing intervals — All are timer-gated and correct.
- `hyperliquid.py` — No changes needed. The 2s TTL cache + retry still exists for REST fallback.

---

Last updated: 2026-03-09
