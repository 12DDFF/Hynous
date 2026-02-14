# Trade Retrieval Issues — Root Cause Analysis

> Hynous fails to reliably retrieve trade memories. Investigation revealed three code-level problems: missing temporal metadata on trade nodes, ambiguous type mapping, and the agent defaulting to the wrong tool for trade thesis retrieval.

---

## Problem 1: No `event_time` on trade nodes (PRIMARY)

**Location:** `src/hynous/intelligence/tools/trading.py` — `_store_to_nous()` (line 844–909)

**What happens:** `_store_to_nous()` calls `client.create_node()` with only `type`, `subtype`, `title`, `body`, and `summary`. It never passes `event_time`, `event_confidence`, or `event_source`:

```python
# trading.py:874-880
node = client.create_node(
    type="concept",
    subtype=subtype,
    title=title,
    body=body,
    summary=summary,
    # ← event_time, event_confidence, event_source: MISSING
)
```

**The client supports it.** `NousClient.create_node()` (`src/hynous/nous/client.py:56–83`) accepts all three temporal fields and maps them to `temporal_event_time`, `temporal_event_confidence`, `temporal_event_source` in the payload. They just never get passed from `_store_to_nous()`.

**Contrast with `store_memory` tool.** `_store_memory_impl()` in `tools/memory.py` (line 442–451) correctly auto-sets `event_time` for trade types:

```python
# memory.py:446-451
if memory_type in ("episode", "signal", "trade", "trade_entry", "trade_close", "trade_modify"):
    if not _event_time:
        _event_time = datetime.now(timezone.utc).isoformat()
    _event_confidence = 1.0
    _event_source = "explicit" if event_time else "inferred"
```

But `_store_to_nous()` is a separate code path used by the trading tools (`execute_trade`, `close_position`, `modify_position`). It bypasses `store_memory` entirely — so it never hits this auto-set logic.

**Result:** All 17 `trade_entry` nodes in the database have `temporal_event_time: None`. When Hynous used `time_type="event"` in his `recall_memory` filter, the Nous time-range search (search.ts:129-137) checked only the `temporal_event_time` field — which is empty — and matched zero nodes.

Note: `time_type="any"` would actually work as a fallback, since the filter checks both `temporal_event_time` AND `provenance_created_at`, and `provenance_created_at` is always populated. But the agent naturally chooses `time_type="event"` for trade events, and the missing `temporal_event_time` makes that path fail completely.

**Fix:** Add temporal fields to `_store_to_nous()`. The trade execution timestamp is known at call time — pass it through.

---

## Problem 2: Possible `memory_type` mismatch (SECONDARY)

**Location:** `src/hynous/intelligence/tools/memory.py` — `_TYPE_MAP` (line 256–271)

**What happens:** `_TYPE_MAP` has separate entries for `"trade"` and `"trade_entry"`:

```python
# memory.py:256-271
_TYPE_MAP = {
    "trade":       ("concept", "custom:trade"),        # ← manual trade records
    "trade_entry": ("concept", "custom:trade_entry"),  # ← auto-created by execute_trade
    "trade_close": ("concept", "custom:trade_close"),
    "trade_modify":("concept", "custom:trade_modify"),
    # ...
}
```

If Hynous filtered by `memory_type="trade"` (a natural guess for "find my trades"), the subtype filter resolves to `custom:trade` — which does NOT match the auto-created `custom:trade_entry` nodes from the trading tool. He'd need `memory_type="trade_entry"` specifically.

Note: `recall_memory`'s enum (memory.py:677-679) does include `"trade_entry"`, `"trade_modify"`, and `"trade_close"` alongside `"trade"`. So the agent can use the correct subtype if it knows to — but `"trade"` is the natural choice for "find my trades" and it maps to the wrong subtype.

**Impact:** From Hynous's description, the time filter (Problem 1) was the primary killer — he explicitly said he used `time_type="event"` with `time_start`/`time_end`. But if he also filtered by `memory_type="trade"` instead of `"trade_entry"`, that would have been a second independent filter mismatch.

**Fix:** Either:
- Rename `"trade"` → `"trade_manual"` to avoid confusion, or
- Make `"trade"` a catch-all that matches all trade subtypes (`custom:trade`, `custom:trade_entry`, `custom:trade_close`, `custom:trade_modify`), or
- Improve tool description to clarify the distinction

---

## Problem 3: `get_trade_stats` cannot retrieve theses or filter by time

**Location:** `src/hynous/intelligence/tools/trade_stats.py` (161 lines) and `src/hynous/core/trade_analytics.py` (310 lines)

**Observed behavior:** When prompted "retrieve the 3 most recent trades and their results, give me the theses behind them," Hynous selects `get_trade_stats` instead of `recall_memory`. The tool returns a mechanical performance summary with no thesis content and no way to limit by recency.

### Sub-issue 3a: Only reads `trade_close` nodes, not `trade_entry`

`trade_analytics.py` fetches trade history from `trade_close` nodes only:

```python
# trade_analytics.py:67
nodes = nous_client.list_nodes(subtype="custom:trade_close", limit=50)
```

Trade theses are stored on `custom:trade_entry` nodes (created by `execute_trade` → `_store_trade_memory()`). The `trade_close` nodes contain close reasoning (why the position was exited), not the original entry thesis. The tool structurally cannot access entry theses.

### Sub-issue 3b: No time or limit filtering

The tool definition has only one optional parameter:

```python
# trade_stats.py:14-34
"parameters": {
    "type": "object",
    "properties": {
        "symbol": {
            "type": "string",
            "description": "Filter to a specific symbol (e.g. BTC, ETH, SOL). Omit for all.",
        },
    },
},
```

No `limit`, `time_start`, `time_end`, or `recent` parameter exists. The underlying `fetch_trade_history()` hardcodes `limit=50` for all `trade_close` nodes, and the output formatter shows the last 5: `for t in stats.trades[:5]`.

When the agent wants "the 3 most recent trades," it has no way to express that constraint through this tool.

### Sub-issue 3c: `TradeRecord` has no thesis field

The `TradeRecord` dataclass in `trade_analytics.py` contains only mechanical fields:

```python
# trade_analytics.py:24-36
@dataclass
class TradeRecord:
    symbol: str
    side: str
    entry_px: float
    exit_px: float
    pnl_usd: float
    pnl_pct: float
    close_type: str
    closed_at: str
    size_usd: float = 0.0
    duration_hours: float = 0.0
```

No `thesis`, `reasoning`, or `body` field. Even if the tool read `trade_entry` nodes, it would discard the thesis content during parsing.

### Sub-issue 3d: Agent selects wrong tool due to description overlap

The agent chooses `get_trade_stats` because the TOOL_DEF description (trade_stats.py:16-23) reads: *"View your trading performance — win rate, total PnL, profit factor, per-symbol breakdown, and recent trade history."* — which sounds relevant to "retrieve my recent trades and their results." But the tool is designed for aggregate analytics (win rate, average PnL, streaks), not individual trade retrieval with narrative context.

The correct approach is `recall_memory(mode="browse", memory_type="trade_entry", limit=3)`, which uses `list_nodes(subtype="custom:trade_entry")` ordered by `created_at DESC` and returns the full node body (including thesis text).

**Fix options:**
- **Minimal:** Improve `get_trade_stats` description to clarify it's for aggregate stats only, and update the agent prompt to direct thesis retrieval to `recall_memory`
- **Better:** Add `limit` and time filtering to `get_trade_stats`, and have it also read `trade_entry` nodes for thesis content
- **Best:** Create a dedicated `get_recent_trades` tool that joins `trade_entry` + `trade_close` nodes by symbol/timestamp, returning a unified view with entry thesis, execution details, and outcome

---

## Evidence

- All 3 Feb 13 trades confirmed in database: LONG BTC @ $68,562, LONG ETH @ $2,031, LONG SOL @ $83.10
- All 17 `trade_entry` nodes have `temporal_event_time: null`
- Search for "micro trades february 13" with no subtype filter returns only `turn_summary` nodes (zero `trade_entry`)
- Search with explicit `subtype=custom:trade_entry` filter (no time filter) returns the trades correctly
- `get_trade_stats` tool has only a `symbol` parameter — no time or limit filtering
- `trade_analytics.py` queries only `trade_close` nodes (line 67), never `trade_entry`
- `TradeRecord` dataclass has no thesis/reasoning field
- Agent selects `get_trade_stats` for thesis retrieval because TOOL_DEF says "recent trade history" and "per-symbol breakdown"
- `recall_memory` enum does include `trade_entry` as a valid `memory_type` — agent can use it but naturally defaults to `"trade"`

## Status

**ALL FIXED** — implemented via `revisions/trade-recall/implementation-guide.md`.

### Changes Made

**Problem 1 — Missing `event_time`:**
- `_store_to_nous()` in `trading.py` now passes `event_time=datetime.now(timezone.utc).isoformat()`, `event_confidence=1.0`, `event_source="inferred"` to `create_node()`. All three callers (entry, close, modify) get timestamps automatically.

**Problem 2 — `memory_type` mismatch:**
- `handle_recall_memory()` in `memory.py` normalizes `"trade"` → `"trade_entry"` before `_TYPE_MAP` lookup. `_TYPE_MAP` itself unchanged (store path unaffected).

**Problem 3 — `get_trade_stats` thesis + time filtering:**
- `TradeRecord` now has `thesis: str = ""` field
- New `_enrich_from_entry()` traverses `part_of` edges from close→entry nodes, extracts both duration and thesis
- `fetch_trade_history()` and `get_trade_stats()` accept `created_after`/`created_before` time filters
- `get_trade_stats()` bypasses cache when filter params present
- `TOOL_DEF` has new `limit`, `time_start`, `time_end` parameters
- Formatters show thesis under each trade and respect `limit`
- Nous `list_nodes` endpoint accepts `created_after`/`created_before` query params
- `NousClient.list_nodes()` passes time filter params through

**Tests:** 29 unit + 6 integration tests added. Full suite: 200/200 Python tests pass, zero regressions.
