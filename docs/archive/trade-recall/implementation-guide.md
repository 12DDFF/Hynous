# Trade Retrieval Issues — Implementation Guide

> Step-by-step guide for fixing all three trade retrieval issues. Designed for an engineer agent with limited context. Read the required files first, then follow each step in order.

---

## Context: What's Broken

Hynous (the trading agent) cannot reliably retrieve its own trade memories. Three independent bugs compound:

1. **No `event_time` on trade nodes.** The `_store_to_nous()` function in `trading.py` stores trade memories without timestamps. All trade nodes have `temporal_event_time: null`. When the agent searches trades by date using `time_type="event"`, the Nous time-range filter checks only the empty `temporal_event_time` field and matches nothing.

2. **`memory_type="trade"` maps to the wrong subtype.** The `_TYPE_MAP` in `memory.py` maps `"trade"` → `custom:trade`, but all auto-created trades use `custom:trade_entry`. When the agent filters by `memory_type="trade"` (the natural choice for "find my trades"), it silently misses every trade.

3. **`get_trade_stats` cannot retrieve theses or filter by time.** When asked "show me my recent trades with theses," the agent selects `get_trade_stats`. But this tool only reads `trade_close` nodes (not `trade_entry` where theses live), has no time or limit filtering, and the `TradeRecord` dataclass has no thesis field. The agent gets mechanical PnL stats instead of the trade reasoning it was asked for.

**Full root cause analysis:** `revisions/trade-recall/retrieval-issues.md`

---

## Required Reading

Read ALL of these files before implementing. They contain the exact code you'll be modifying and the patterns you must follow.

### Core Files to Modify

| File | What to Read For |
|------|------------------|
| `src/hynous/intelligence/tools/trading.py` | `_store_to_nous()` (line 844–909), `_store_trade_memory()` (line 938–1031), close handler's `_store_to_nous()` call (line 1233), modify handler's `_store_to_nous()` call (line 1521). All three are callers you'll affect. |
| `src/hynous/intelligence/tools/memory.py` | `_TYPE_MAP` (line 256–271), `handle_recall_memory()` (line 762–), browse mode (line 787–793). Understand the type resolution flow. |
| `src/hynous/intelligence/tools/trade_stats.py` | Full file (161 lines). `TOOL_DEF` (line 14–34), `handle_get_trade_stats()` (line 37–50), `_format_full_report()` (line 53–118). |
| `src/hynous/core/trade_analytics.py` | Full file (310 lines). `TradeRecord` (line 24–36), `fetch_trade_history()` (line 60–86), `_parse_trade_node()` (line 89–133), `_find_duration()` (line 136–165), `get_trade_stats()` (line 276–288) with cache logic. |
| `src/hynous/nous/client.py` | `create_node()` (line 56–83) — already supports temporal fields. `list_nodes()` (line 93–110) — you'll add time params. |
| `nous-server/server/src/routes/nodes.ts` | LIST endpoint (line 178–209) — you'll add `created_after`/`created_before` filtering. |

### Context Files (Read for Patterns)

| File | Why |
|------|-----|
| `revisions/trade-recall/retrieval-issues.md` | Full problem documentation with code evidence |
| `src/hynous/intelligence/tools/registry.py` | Tool registration pattern (no changes needed, just understand it) |
| `nous-server/server/src/routes/search.ts` (line 119–139) | Time-range filter pattern — see how search uses `created_after` style filtering |
| `tests/unit/test_gate_filter.py` | Python test style and conventions |
| `tests/integration/test_orchestrator_integration.py` | Integration test pattern: litellm stub, mock NousClient, `_make_config()` helper |
| `tests/conftest.py` | Shared fixtures (currently minimal) |

---

## Implementation Order

Implement in this order. Each problem is independent but Problem 3 depends on Problem 1 being done (thesis extraction from entry nodes uses the same code path).

---

## Problem 1: Add `event_time` to `_store_to_nous()`

### File: `src/hynous/intelligence/tools/trading.py`

### Step 1.1: Update `_store_to_nous()` signature

At line 844, add an `event_time` parameter:

```python
def _store_to_nous(
    subtype: str,
    title: str,
    content: str,
    summary: str,
    signals: dict | None = None,
    link_to: str | None = None,
    edge_type: str = "part_of",
    event_time: str | None = None,        # ADD THIS
) -> str | None:
```

### Step 1.2: Auto-generate timestamp and pass to `create_node()`

Inside `_store_to_nous()`, after the `body = json.dumps(body_data)` line (currently line 870) and before the `try:` block (currently line 872), add timestamp generation:

```python
    body = json.dumps(body_data)

    # Auto-set event_time if not provided (trade events happen NOW)
    if not event_time:
        from datetime import datetime, timezone
        event_time = datetime.now(timezone.utc).isoformat()

    try:
```

Then modify the `client.create_node()` call (currently line 874–880) to pass the temporal fields:

```python
        node = client.create_node(
            type="concept",
            subtype=subtype,
            title=title,
            body=body,
            summary=summary,
            event_time=event_time,
            event_confidence=1.0,
            event_source="inferred",
        )
```

### Step 1.3: No caller changes needed

All three callers (`_store_trade_memory()` at line 991, close handler at line 1233, modify handler at line 1521) call `_store_to_nous()` without `event_time`, so the auto-generation handles them all. No changes to callers required.

### Verification

- Confirm `_store_to_nous()` now has `event_time` parameter with default `None`
- Confirm the auto-generation block runs `datetime.now(timezone.utc).isoformat()`
- Confirm `create_node()` receives `event_time`, `event_confidence=1.0`, `event_source="inferred"`
- Confirm no other callers of `_store_to_nous()` exist (grep for `_store_to_nous(` in the file — expect exactly 4 hits: definition + 3 calls)

---

## Problem 2: Fix `memory_type="trade"` mapping

### File: `src/hynous/intelligence/tools/memory.py`

### Step 2.1: Normalize `"trade"` to `"trade_entry"` in recall handler

In `handle_recall_memory()` (line 762), add a normalization step before the `_TYPE_MAP` lookup. After the function signature and before the `# Map memory_type to subtype filter` comment (currently line 776):

```python
def handle_recall_memory(
    mode: str = "search",
    query: Optional[str] = None,
    memory_type: Optional[str] = None,
    active_only: bool = False,
    limit: int = 10,
    time_start: Optional[str] = None,
    time_end: Optional[str] = None,
    time_type: Optional[str] = None,
    cluster: Optional[str] = None,
) -> str:
    """Search or browse memories in Nous."""
    from ...nous.client import get_client

    # Normalize "trade" → "trade_entry" for recall.
    # Auto-created trades use subtype "custom:trade_entry" (via execute_trade),
    # but agents naturally filter by "trade". Map to what actually exists.
    if memory_type == "trade":
        memory_type = "trade_entry"

    # Map memory_type to subtype filter
    subtype = None
    node_type = None
```

### Step 2.2: Do NOT change `_TYPE_MAP` or `store_memory`

The `_TYPE_MAP` entry for `"trade"` is still used by `store_memory` for manual trade records. Leave it as-is. The fix is recall-side only.

### Verification

- Confirm `handle_recall_memory()` has the normalization block
- Confirm `_TYPE_MAP` is unchanged
- Confirm `store_memory` TOOL_DEF enum is unchanged
- Test: `recall_memory(mode="browse", memory_type="trade")` should now resolve to `subtype="custom:trade_entry"`

---

## Problem 3: Enhance `get_trade_stats` with thesis retrieval and time filtering

This is the largest change. It spans 4 files across Python and TypeScript.

### Step 3.1: Add time filtering to Nous `list_nodes` endpoint

**File: `nous-server/server/src/routes/nodes.ts`**

In the LIST handler (line 178), add `created_after` and `created_before` query params. After the existing `lifecycle` param parsing (line 181) and before the SQL building (line 184):

```typescript
nodes.get('/nodes', async (c) => {
  const type = c.req.query('type');
  const subtype = c.req.query('subtype');
  const lifecycle = c.req.query('lifecycle');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const created_after = c.req.query('created_after');    // ADD
  const created_before = c.req.query('created_before');  // ADD

  let sql = 'SELECT * FROM nodes WHERE 1=1';
  const args: (string | number)[] = [];

  if (type) {
    sql += ' AND type = ?';
    args.push(type);
  }
  if (subtype) {
    sql += ' AND subtype = ?';
    args.push(subtype);
  }
  if (lifecycle) {
    sql += ' AND state_lifecycle = ?';
    args.push(lifecycle);
  }
  if (created_after) {                    // ADD
    sql += ' AND created_at >= ?';        // ADD
    args.push(created_after);             // ADD
  }                                       // ADD
  if (created_before) {                   // ADD
    sql += ' AND created_at <= ?';        // ADD
    args.push(created_before);            // ADD
  }                                       // ADD

  sql += ' ORDER BY created_at DESC LIMIT ?';
  args.push(limit);
  // ... rest unchanged
```

### Step 3.2: Add time params to `NousClient.list_nodes()`

**File: `src/hynous/nous/client.py`**

Update the `list_nodes()` method (line 93–110):

```python
    def list_nodes(
        self,
        type: Optional[str] = None,
        subtype: Optional[str] = None,
        lifecycle: Optional[str] = None,
        limit: int = 50,
        created_after: Optional[str] = None,   # ADD
        created_before: Optional[str] = None,   # ADD
    ) -> list[dict]:
        """List nodes with optional filters."""
        params: dict = {"limit": limit}
        if type:
            params["type"] = type
        if subtype:
            params["subtype"] = subtype
        if lifecycle:
            params["lifecycle"] = lifecycle
        if created_after:                        # ADD
            params["created_after"] = created_after
        if created_before:                       # ADD
            params["created_before"] = created_before
        resp = self._session.get(self._url("/nodes"), params=params)
        resp.raise_for_status()
        return resp.json().get("data", [])
```

### Step 3.3: Add `thesis` field to `TradeRecord`

**File: `src/hynous/core/trade_analytics.py`**

Update the `TradeRecord` dataclass (line 24–36):

```python
@dataclass
class TradeRecord:
    """One closed trade parsed from Nous."""
    symbol: str
    side: str           # "long" or "short"
    entry_px: float
    exit_px: float
    pnl_usd: float
    pnl_pct: float
    close_type: str     # "full", "50% partial", etc.
    closed_at: str      # ISO timestamp
    size_usd: float = 0.0
    duration_hours: float = 0.0
    thesis: str = ""    # ADD — entry thesis from linked trade_entry node
```

### Step 3.4: Refactor `_find_duration()` → `_enrich_from_entry()`

**File: `src/hynous/core/trade_analytics.py`**

Replace `_find_duration()` (line 136–165) with `_enrich_from_entry()` that returns both duration and thesis:

```python
def _enrich_from_entry(close_node: dict, nous_client, closed_at: str) -> dict:
    """Find the linked entry node and extract duration + thesis."""
    result = {"duration_hours": 0.0, "thesis": ""}

    try:
        node_id = close_node.get("id")
        if not node_id:
            return result

        edges = nous_client.get_edges(node_id, direction="in")
        for edge in edges:
            if edge.get("type") == "part_of":
                source_id = edge.get("source_id")
                if source_id:
                    entry_node = nous_client.get_node(source_id)
                    if entry_node:
                        # Duration
                        entry_time = entry_node.get("created_at", "")
                        if entry_time and closed_at:
                            result["duration_hours"] = _hours_between(entry_time, closed_at)

                        # Thesis — extract from entry node body
                        body_raw = entry_node.get("content_body", "")
                        try:
                            body = json.loads(body_raw)
                            text = body.get("text", "")
                            # _store_trade_memory formats as "Thesis: ...\nEntry: ...\n..."
                            for line in text.split("\n"):
                                if line.startswith("Thesis: "):
                                    result["thesis"] = line[len("Thesis: "):]
                                    break
                            # Fallback: use first line if no "Thesis:" prefix
                            if not result["thesis"] and text:
                                result["thesis"] = text.split("\n")[0][:200]
                        except (json.JSONDecodeError, TypeError):
                            if body_raw:
                                result["thesis"] = body_raw.split("\n")[0][:200]

                    break  # Only need the first part_of edge
    except Exception:
        pass

    # Fallback duration from signals (existing logic)
    if result["duration_hours"] == 0.0:
        try:
            body = json.loads(close_node.get("content_body", "{}"))
            signals = body.get("signals", {})
            opened_at = signals.get("opened_at", "")
            if opened_at and closed_at:
                result["duration_hours"] = _hours_between(opened_at, closed_at)
        except Exception:
            pass

    return result
```

### Step 3.5: Update `_parse_trade_node()` to use `_enrich_from_entry()`

**File: `src/hynous/core/trade_analytics.py`**

In `_parse_trade_node()` (line 89–133), replace the `_find_duration` call and the return:

Find this block (currently line 119–133):
```python
    closed_at = node.get("created_at", "")

    # Try to find duration by matching entry node via part_of edges
    duration_hours = _find_duration(node, nous_client, closed_at)

    return TradeRecord(
        symbol=symbol,
        side=side,
        entry_px=entry_px,
        exit_px=exit_px,
        pnl_usd=pnl_usd,
        pnl_pct=pnl_pct,
        close_type=close_type,
        closed_at=closed_at,
        size_usd=size_usd,
        duration_hours=duration_hours,
    )
```

Replace with:
```python
    closed_at = node.get("created_at", "")

    # Enrich from linked entry node (duration + thesis)
    enrichment = _enrich_from_entry(node, nous_client, closed_at)

    return TradeRecord(
        symbol=symbol,
        side=side,
        entry_px=entry_px,
        exit_px=exit_px,
        pnl_usd=pnl_usd,
        pnl_pct=pnl_pct,
        close_type=close_type,
        closed_at=closed_at,
        size_usd=size_usd,
        duration_hours=enrichment["duration_hours"],
        thesis=enrichment["thesis"],
    )
```

### Step 3.6: Add time/limit params to `fetch_trade_history()`

**File: `src/hynous/core/trade_analytics.py`**

Update `fetch_trade_history()` (line 60–86) to accept and pass through time/limit params:

```python
def fetch_trade_history(
    nous_client=None,
    limit: int = 50,                           # ADD (was hardcoded)
    created_after: str | None = None,          # ADD
    created_before: str | None = None,         # ADD
) -> list[TradeRecord]:
    """Query Nous for trade_close nodes and parse into TradeRecords."""
    if nous_client is None:
        from ..nous.client import get_client
        nous_client = get_client()

    try:
        nodes = nous_client.list_nodes(
            subtype="custom:trade_close",
            limit=limit,
            created_after=created_after,        # ADD
            created_before=created_before,       # ADD
        )
    except Exception as e:
        logger.debug("Failed to fetch trade_close nodes: %s", e)
        return []

    # ... rest of function unchanged
```

### Step 3.7: Update `get_trade_stats()` cache logic

**File: `src/hynous/core/trade_analytics.py`**

Replace `get_trade_stats()` (line 276–288) with cache-bypass logic for filtered queries:

```python
def get_trade_stats(
    nous_client=None,
    limit: int = 50,
    created_after: str | None = None,
    created_before: str | None = None,
) -> TradeStats:
    """Main entry point — cached for 30s (default queries only)."""
    global _cached_stats, _cache_time

    has_filters = created_after or created_before or limit != 50

    # Use cache for default (unfiltered) queries only
    if not has_filters:
        now = time.time()
        if _cached_stats is not None and (now - _cache_time) < _CACHE_TTL:
            return _cached_stats

    trades = fetch_trade_history(
        nous_client,
        limit=limit,
        created_after=created_after,
        created_before=created_before,
    )
    stats = compute_stats(trades)

    # Only cache unfiltered results
    if not has_filters:
        _cached_stats = stats
        _cache_time = time.time()

    return stats
```

### Step 3.8: Update `trade_stats.py` TOOL_DEF and handler

**File: `src/hynous/intelligence/tools/trade_stats.py`**

Replace the `TOOL_DEF` (line 14–34):

```python
TOOL_DEF = {
    "name": "get_trade_stats",
    "description": (
        "View your trading performance and trade history.\n\n"
        "Returns aggregate stats (win rate, PnL, profit factor, streaks) "
        "plus recent trades with entry theses and outcomes.\n\n"
        "Use this to review your performance or recall specific trades.\n\n"
        "Examples:\n"
        '  {} → full performance report with last 5 trades\n'
        '  {"symbol": "BTC"} → BTC-only stats\n'
        '  {"limit": 3} → last 3 trades with theses\n'
        '  {"time_start": "2026-02-01", "time_end": "2026-02-14"} → trades in date range'
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "symbol": {
                "type": "string",
                "description": "Filter to a specific symbol (e.g. BTC, ETH, SOL). Omit for all.",
            },
            "limit": {
                "type": "integer",
                "description": "Max trades to include in the recent trades section. Default 5.",
                "minimum": 1,
                "maximum": 50,
            },
            "time_start": {
                "type": "string",
                "description": "ISO date — only include trades closed after this date (e.g. 2026-02-01).",
            },
            "time_end": {
                "type": "string",
                "description": "ISO date — only include trades closed before this date (e.g. 2026-02-14).",
            },
        },
    },
}
```

Update `handle_get_trade_stats()` (line 37–50):

```python
def handle_get_trade_stats(
    symbol: str | None = None,
    limit: int = 5,
    time_start: str | None = None,
    time_end: str | None = None,
) -> str:
    """Handle the get_trade_stats tool call."""
    from ...core.trade_analytics import get_trade_stats

    # Map agent-facing params to analytics params
    # Fetch more than display limit so aggregate stats are comprehensive
    fetch_limit = 50 if not time_start and not time_end else 200

    stats = get_trade_stats(
        limit=fetch_limit,
        created_after=time_start,
        created_before=time_end,
    )

    if stats.total_trades == 0:
        if time_start or time_end:
            return f"No closed trades in the specified time range."
        return "No closed trades yet. Start trading to build your track record."

    if symbol:
        symbol = symbol.upper()
        return _format_symbol_report(stats, symbol, limit)

    return _format_full_report(stats, limit)
```

### Step 3.9: Update output formatters to show thesis and respect `limit`

**File: `src/hynous/intelligence/tools/trade_stats.py`**

Update `_format_full_report()` (line 53–118) to accept `limit` and show thesis:

Change the function signature:
```python
def _format_full_report(stats, limit: int = 5) -> str:
```

Replace the "Recent trades" section (currently line 100–116):
```python
    # Recent trades
    if stats.trades:
        lines.append("")
        lines.append(f"--- Recent Trades (last {min(limit, len(stats.trades))}) ---")
        for t in stats.trades[:limit]:
            s = "+" if t.pnl_usd >= 0 else ""
            dur_str = ""
            if t.duration_hours > 0:
                if t.duration_hours >= 24:
                    dur_str = f" ({t.duration_hours / 24:.1f}d)"
                else:
                    dur_str = f" ({t.duration_hours:.1f}h)"
            lines.append(
                f"  {t.symbol} {t.side.upper()} | "
                f"${t.entry_px:,.0f} → ${t.exit_px:,.0f} | "
                f"{s}${t.pnl_usd:.2f} ({t.pnl_pct:+.1f}%){dur_str}"
            )
            if t.thesis:
                lines.append(f"    Thesis: {t.thesis}")
```

Update `_format_symbol_report()` (line 121–148) signature:
```python
def _format_symbol_report(stats, symbol: str, limit: int = 5) -> str:
```

And update its recent trades loop (currently line 136–146):
```python
    # Recent trades for this symbol
    sym_trades = [t for t in stats.trades if t.symbol == symbol]
    if sym_trades:
        lines.append("")
        lines.append("--- Recent ---")
        for t in sym_trades[:limit]:
            ts = "+" if t.pnl_usd >= 0 else ""
            lines.append(
                f"  {t.side.upper()} | "
                f"${t.entry_px:,.0f} → ${t.exit_px:,.0f} | "
                f"{ts}${t.pnl_usd:.2f} ({t.pnl_pct:+.1f}%)"
            )
            if t.thesis:
                lines.append(f"    Thesis: {t.thesis}")
```

---

## Testing

### Test File Locations

| Test File | Tests For |
|-----------|-----------|
| `tests/unit/test_trade_retrieval.py` | **CREATE** — Unit tests for all 3 problems |
| `tests/integration/test_trade_retrieval_integration.py` | **CREATE** — Integration tests with mock NousClient |
| Nous endpoint test (manual or script) | TypeScript `list_nodes` time filtering |

### Unit Tests: `tests/unit/test_trade_retrieval.py`

Create this file. Follow the patterns in `tests/unit/test_gate_filter.py` (class-based, descriptive names, one assertion per test where possible). Use `unittest.mock` for all external dependencies.

**Critical:** Stub `litellm` before importing any `hynous.intelligence` modules (see `tests/integration/test_orchestrator_integration.py` lines 14–18 for the pattern):

```python
import sys
import types
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception
```

#### Problem 1 Tests

```python
class TestStoreToNousEventTime:
    """Verify _store_to_nous() passes temporal fields to create_node()."""

    def test_auto_generates_event_time(self):
        """When no event_time provided, auto-generates ISO timestamp."""
        # Mock get_client, get_tracker
        # Call _store_to_nous(subtype="custom:trade_entry", title="...", content="...", summary="...")
        # Assert client.create_node was called with event_time (ISO string), event_confidence=1.0, event_source="inferred"

    def test_uses_provided_event_time(self):
        """When event_time is explicitly provided, uses it as-is."""
        # Call _store_to_nous(..., event_time="2026-02-14T12:00:00+00:00")
        # Assert client.create_node was called with that exact event_time

    def test_event_time_is_valid_iso_format(self):
        """Auto-generated event_time is parseable ISO 8601."""
        # Call _store_to_nous(...)
        # Extract the event_time passed to create_node
        # Assert datetime.fromisoformat(event_time) doesn't raise

    def test_all_trade_subtypes_get_event_time(self):
        """trade_entry, trade_close, and trade_modify all get timestamps."""
        # Call _store_to_nous for each subtype
        # Assert create_node received event_time for each
```

#### Problem 2 Tests

```python
class TestTradeTypeNormalization:
    """Verify recall_memory normalizes 'trade' to 'trade_entry'."""

    def test_trade_maps_to_trade_entry_in_browse(self):
        """memory_type='trade' in browse mode queries custom:trade_entry."""
        # Mock get_client
        # Call handle_recall_memory(mode="browse", memory_type="trade")
        # Assert client.list_nodes was called with subtype="custom:trade_entry"

    def test_trade_maps_to_trade_entry_in_search(self):
        """memory_type='trade' in search mode uses custom:trade_entry subtype."""
        # Mock get_client, orchestrator
        # Call handle_recall_memory(mode="search", query="BTC trades", memory_type="trade")
        # Assert search was called with subtype="custom:trade_entry"

    def test_trade_entry_still_works_directly(self):
        """memory_type='trade_entry' is not double-mapped."""
        # Call handle_recall_memory(mode="browse", memory_type="trade_entry")
        # Assert client.list_nodes was called with subtype="custom:trade_entry"

    def test_trade_close_unaffected(self):
        """memory_type='trade_close' still maps to custom:trade_close."""
        # Call handle_recall_memory(mode="browse", memory_type="trade_close")
        # Assert client.list_nodes was called with subtype="custom:trade_close"

    def test_store_memory_trade_type_unchanged(self):
        """store_memory with memory_type='trade' still creates custom:trade."""
        # Verify _TYPE_MAP["trade"] == ("concept", "custom:trade")
        # This confirms store path is unchanged
```

#### Problem 3 Tests

```python
class TestTradeRecordThesis:
    """Verify TradeRecord includes thesis field."""

    def test_thesis_field_exists(self):
        from hynous.core.trade_analytics import TradeRecord
        record = TradeRecord(
            symbol="BTC", side="long", entry_px=68000, exit_px=70000,
            pnl_usd=200, pnl_pct=2.9, close_type="full", closed_at="2026-02-14",
        )
        assert record.thesis == ""  # default empty

    def test_thesis_field_stores_value(self):
        from hynous.core.trade_analytics import TradeRecord
        record = TradeRecord(
            symbol="BTC", side="long", entry_px=68000, exit_px=70000,
            pnl_usd=200, pnl_pct=2.9, close_type="full", closed_at="2026-02-14",
            thesis="Funding reset + support held at 67K"
        )
        assert record.thesis == "Funding reset + support held at 67K"


class TestEnrichFromEntry:
    """Verify _enrich_from_entry() extracts duration and thesis."""

    def test_extracts_thesis_from_entry_body(self):
        """Parses 'Thesis: ...' from JSON body of linked entry node."""
        # Mock nous_client.get_edges → [{"type": "part_of", "source_id": "n_entry"}]
        # Mock nous_client.get_node("n_entry") → {"content_body": '{"text": "Thesis: BTC bullish\\nEntry: ..."}', "created_at": "..."}
        # Call _enrich_from_entry(close_node, nous_client, closed_at)
        # Assert result["thesis"] == "BTC bullish"

    def test_extracts_duration(self):
        """Calculates hours between entry and close timestamps."""
        # Same mock setup with known timestamps
        # Assert result["duration_hours"] > 0

    def test_returns_empty_thesis_when_no_edge(self):
        """Returns empty thesis when no part_of edge exists."""
        # Mock get_edges → []
        # Assert result["thesis"] == ""

    def test_returns_empty_thesis_on_api_error(self):
        """Handles Nous errors gracefully."""
        # Mock get_edges → raise Exception
        # Assert result["thesis"] == ""

    def test_fallback_first_line_when_no_thesis_prefix(self):
        """Uses first line of body when no 'Thesis:' prefix found."""
        # Mock entry body: '{"text": "Some reasoning about BTC\\nMore details"}'
        # Assert result["thesis"] == "Some reasoning about BTC"


class TestGetTradeStatsCaching:
    """Verify cache bypass for filtered queries."""

    def test_default_query_uses_cache(self):
        """get_trade_stats() with no params uses 30s cache."""
        # Call get_trade_stats() twice within 30s
        # Assert fetch_trade_history called only once

    def test_filtered_query_bypasses_cache(self):
        """get_trade_stats(created_after=...) always hits Nous."""
        # Call get_trade_stats() to populate cache
        # Call get_trade_stats(created_after="2026-02-01")
        # Assert fetch_trade_history called twice

    def test_limit_query_bypasses_cache(self):
        """get_trade_stats(limit=3) bypasses cache."""
        # Call get_trade_stats() to populate cache
        # Call get_trade_stats(limit=3)
        # Assert fetch_trade_history called twice

    def test_filtered_result_not_cached(self):
        """Filtered queries don't pollute the default cache."""
        # Call get_trade_stats(created_after="2026-02-01")
        # Assert _cached_stats is still None (or previous default)


class TestTradeStatsToolDef:
    """Verify TOOL_DEF has new parameters."""

    def test_has_limit_param(self):
        from hynous.intelligence.tools.trade_stats import TOOL_DEF
        assert "limit" in TOOL_DEF["parameters"]["properties"]

    def test_has_time_start_param(self):
        from hynous.intelligence.tools.trade_stats import TOOL_DEF
        assert "time_start" in TOOL_DEF["parameters"]["properties"]

    def test_has_time_end_param(self):
        from hynous.intelligence.tools.trade_stats import TOOL_DEF
        assert "time_end" in TOOL_DEF["parameters"]["properties"]

    def test_description_mentions_theses(self):
        from hynous.intelligence.tools.trade_stats import TOOL_DEF
        assert "thes" in TOOL_DEF["description"].lower()


class TestTradeStatsOutput:
    """Verify output includes thesis text."""

    def test_full_report_includes_thesis(self):
        """_format_full_report shows thesis under each trade."""
        # Build a TradeStats with trades that have thesis text
        # Call _format_full_report(stats, limit=5)
        # Assert "Thesis:" in output

    def test_full_report_respects_limit(self):
        """_format_full_report shows at most `limit` trades."""
        # Build TradeStats with 10 trades
        # Call _format_full_report(stats, limit=3)
        # Count occurrences of trade lines — should be 3

    def test_symbol_report_includes_thesis(self):
        """_format_symbol_report shows thesis under each trade."""
        # Build TradeStats, call _format_symbol_report(stats, "BTC", limit=5)
        # Assert "Thesis:" in output
```

### Integration Tests: `tests/integration/test_trade_retrieval_integration.py`

Create this file. Follow the pattern in `tests/integration/test_orchestrator_integration.py` — stub litellm, build mock NousClient, test full flows.

```python
class TestTradeRetrievalFlow:
    """Full flow: store → recall → verify thesis and time filtering."""

    def test_recall_trade_by_browse_returns_entry(self):
        """recall_memory(mode='browse', memory_type='trade') returns trade_entry nodes."""
        # Mock client.list_nodes to return trade_entry nodes
        # Call handle_recall_memory(mode="browse", memory_type="trade")
        # Assert list_nodes was called with subtype="custom:trade_entry"
        # Assert output contains node content

    def test_trade_stats_with_time_filter(self):
        """get_trade_stats with time range passes filters to list_nodes."""
        # Mock NousClient
        # Call handle_get_trade_stats(time_start="2026-02-01", time_end="2026-02-14")
        # Assert list_nodes called with created_after="2026-02-01", created_before="2026-02-14"

    def test_trade_stats_thesis_in_output(self):
        """Full pipeline: close node → edge → entry node → thesis extracted → shown in output."""
        # Mock client.list_nodes → [trade_close_node]
        # Mock client.get_edges → [{"type": "part_of", "source_id": "n_entry"}]
        # Mock client.get_node("n_entry") → entry node with thesis in body
        # Call handle_get_trade_stats()
        # Assert "Thesis:" in output
```

### Nous Endpoint Test

After modifying `nodes.ts`, verify the endpoint directly:

```bash
# Start Nous server, then test:

# Create a test node
curl -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{"type":"concept","subtype":"custom:trade_close","content_title":"TEST CLOSE","content_body":"{}"}'

# List all — should return the node
curl "http://localhost:3100/v1/nodes?subtype=custom:trade_close"

# List with created_after in the future — should return empty
curl "http://localhost:3100/v1/nodes?subtype=custom:trade_close&created_after=2099-01-01"

# List with created_after in the past — should return the node
curl "http://localhost:3100/v1/nodes?subtype=custom:trade_close&created_after=2020-01-01"

# List with created_before in the past — should return empty
curl "http://localhost:3100/v1/nodes?subtype=custom:trade_close&created_before=2020-01-01"

# Clean up: delete the test node
```

### Run All Tests

```bash
# Python unit tests
pytest tests/unit/test_trade_retrieval.py -v

# Python integration tests
pytest tests/integration/test_trade_retrieval_integration.py -v

# Full Python test suite (ensure no regressions)
pytest tests/ -v

# Nous TypeScript tests (ensure no regressions)
cd nous-server && pnpm test
```

---

## Post-Implementation Verification Checklist

- [ ] `_store_to_nous()` passes `event_time`, `event_confidence`, `event_source` to `create_node()`
- [ ] Auto-generated `event_time` is valid ISO 8601
- [ ] All 3 callers of `_store_to_nous()` (entry, close, modify) get timestamps without code changes
- [ ] `handle_recall_memory()` normalizes `"trade"` → `"trade_entry"` before `_TYPE_MAP` lookup
- [ ] `_TYPE_MAP` itself is unchanged (store path unaffected)
- [ ] `store_memory(memory_type="trade")` still creates `custom:trade` nodes
- [ ] Nous `list_nodes` endpoint accepts `created_after` and `created_before` query params
- [ ] `NousClient.list_nodes()` passes `created_after`/`created_before` to the endpoint
- [ ] `TradeRecord` has a `thesis: str = ""` field
- [ ] `_enrich_from_entry()` extracts thesis from linked entry node's JSON body
- [ ] `_enrich_from_entry()` still returns duration (existing behavior preserved)
- [ ] `_enrich_from_entry()` handles missing edges, API errors, and malformed bodies gracefully
- [ ] `fetch_trade_history()` accepts and passes `limit`, `created_after`, `created_before`
- [ ] `get_trade_stats()` bypasses cache when filter params are present
- [ ] `get_trade_stats()` still caches default (no-param) queries at 30s TTL
- [ ] `TOOL_DEF` has `limit`, `time_start`, `time_end` parameters
- [ ] `TOOL_DEF` description mentions theses and time filtering
- [ ] `handle_get_trade_stats()` accepts and passes new params
- [ ] `_format_full_report()` shows thesis under each trade when available
- [ ] `_format_full_report()` respects `limit` param (not hardcoded to 5)
- [ ] `_format_symbol_report()` shows thesis and respects `limit`
- [ ] All existing Python tests pass (`pytest tests/ -v`)
- [ ] All existing Nous tests pass (`cd nous-server && pnpm test`)
- [ ] New unit tests pass (`pytest tests/unit/test_trade_retrieval.py -v`)
- [ ] New integration tests pass (`pytest tests/integration/test_trade_retrieval_integration.py -v`)

---

## Files Modified Summary

| File | Changes |
|------|---------|
| `src/hynous/intelligence/tools/trading.py` | `_store_to_nous()`: add `event_time` param, auto-generate timestamp, pass to `create_node()` |
| `src/hynous/intelligence/tools/memory.py` | `handle_recall_memory()`: normalize `"trade"` → `"trade_entry"` |
| `src/hynous/intelligence/tools/trade_stats.py` | `TOOL_DEF`: add `limit`, `time_start`, `time_end` params, update description. Handler: pass params through. Formatters: show thesis, respect limit. |
| `src/hynous/core/trade_analytics.py` | `TradeRecord`: add `thesis` field. `_find_duration()` → `_enrich_from_entry()`: extract thesis + duration. `fetch_trade_history()`: accept time/limit params. `get_trade_stats()`: cache bypass for filtered queries. |
| `src/hynous/nous/client.py` | `list_nodes()`: add `created_after`, `created_before` params |
| `nous-server/server/src/routes/nodes.ts` | LIST handler: add `created_after`, `created_before` query param filtering |
| `tests/unit/test_trade_retrieval.py` | **NEW** — Unit tests for all 3 problems |
| `tests/integration/test_trade_retrieval_integration.py` | **NEW** — Integration tests with mock NousClient |
