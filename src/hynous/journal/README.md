# Hynous v2 Journal Module

> Trade journal replacing the Nous TypeScript memory server.
> See `v2-planning/00-master-plan.md` for full context and
> `v2-planning/05-phase-2-journal-module.md` for phase 2's authoritative plan.

---

## Status — Phase 2 complete (2026-04-12)

Phase 1 established the data capture pipeline. Phase 2 replaces the
phase-1 staging store with a production `JournalStore` that the daemon
writes to directly, exposes the data over FastAPI, and supports
semantic search via OpenAI embeddings.

Phase 4 deletes the legacy Nous TypeScript server. Phase 3 (next)
populates the `trade_analyses` table via an LLM post-trade analysis agent.

---

## Files

| File | Purpose |
|------|---------|
| `schema.py` | 19 dataclasses + `entry_snapshot_from_dict` / `exit_snapshot_from_dict` reconstruction helpers + `SCHEMA_DDL` constant |
| `staging_store.py` | Phase-1 thin SQLite wrapper. Kept in tree: two test files still import `StagingStore` for round-trip fixtures. Daemon no longer writes to it (JournalStore is the sole production write target since phase 2 M7). |
| `store.py` | **Phase 2 — `JournalStore`**: 9-table schema, CRUD, semantic search, daemon-compat methods |
| `embeddings.py` | **Phase 2** — `EmbeddingClient` (OpenAI text-embedding-3-small, matryoshka 512-dim), `cosine_similarity`, `build_entry_embedding_text` |
| `api.py` | **Phase 2** — FastAPI router at `/api/v2/journal/*` |
| `migrate_staging.py` | **Phase 2** — idempotent staging→journal migration (auto-runs once at daemon startup) |
| `capture.py` | `build_entry_snapshot()`, `build_exit_snapshot()`, `emit_lifecycle_event()` (phase 2 rewrote `_build_order_flow_state` + `_build_smart_money_context` from placeholders to data-layer-backed builders) |
| `counterfactuals.py` | Post-exit analysis (TP hit later? SL hunted? optimal exit?) |

---

## Production Database

Located at `storage/v2/journal.db` (WAL mode). Nine tables:

| Table | Contents |
|---|---|
| `journal_metadata` | Schema version + one-shot operation flags (`staging_migration_done`) |
| `trades` | One row per trade (taken OR rejected) with status lifecycle |
| `trade_entry_snapshots` | Rich JSON snapshot per trade + optional 512-dim embedding |
| `trade_exit_snapshots` | Exit JSON + separately-queryable counterfactuals column |
| `trade_events` | Chronological mechanical events during hold |
| `trade_analyses` | LLM-produced narrative + grades + findings + embedding (phase 3 populates) |
| `trade_tags` | Free-form labels (`source in {llm, manual, auto}`) |
| `trade_edges` | Trade relationships (phase 6 populates) |
| `trade_patterns` | Weekly rollup aggregates (phase 6 populates) |

---

## JournalStore public API

```python
from hynous.journal.store import JournalStore

store = JournalStore("storage/v2/journal.db", busy_timeout_ms=5000)

# Trade CRUD
store.upsert_trade(trade_id=..., symbol=..., side=..., trade_type=..., status=...)
store.get_trade(trade_id)       # → hydrated bundle with dataclass snapshots
store.list_trades(symbol=..., status=..., since=..., until=..., limit=..., offset=...)

# Snapshots
store.insert_entry_snapshot(snapshot, embedding=None)
store.insert_exit_snapshot(snapshot)

# Lifecycle events
store.insert_lifecycle_event(trade_id=..., ts=..., event_type=..., payload=...)
store.get_events_for_trade(trade_id)

# Analyses (phase 3 writes)
store.insert_analysis(trade_id=..., narrative=..., findings=..., grades=..., ...)
store.get_analysis(trade_id)

# Tags
store.add_tag(trade_id, tag, source="manual")
store.remove_tag(trade_id, tag)
store.get_tags(trade_id)

# Stats + semantic search
store.get_aggregate_stats(since=..., until=..., symbol=...)
store.search_semantic(query_embedding=..., scope="entry"|"analysis", limit=20, symbol=...)

# Metadata (one-shot flags)
store.get_metadata(key)
store.set_metadata(key, value)

# Daemon-compat methods (drop-in replacement for phase-1 StagingStore)
store.get_entry_snapshot_json(trade_id)
store.list_exit_snapshots_needing_counterfactuals()
store.update_exit_snapshot(trade_id, snapshot)
```

---

## FastAPI Routes — `/api/v2/journal/*`

| Method + Path | Returns |
|---|---|
| `GET  /health` | `{status, db_path}` |
| `GET  /trades` | List of `TradeSummary` (symbol, status, exit_classification, since, until, limit, offset filters) |
| `GET  /trades/{trade_id}` | Hydrated bundle (row + snapshots + events + analysis + tags) |
| `GET  /trades/{trade_id}/events` | Chronological events |
| `GET  /trades/{trade_id}/analysis` | LLM analysis (404 if absent) |
| `GET  /stats` | `AggregateStats` (win_rate, total_pnl, profit_factor, avg_hold, best/worst) |
| `GET  /search` | Semantic search (embeds the query, returns ranked trades) |
| `POST /trades/{trade_id}/tags?tag=X` | Attach a tag |
| `DELETE /trades/{trade_id}/tags/{tag}` | Remove a tag |

Mounted in `dashboard/dashboard/dashboard.py` via `app._api.include_router`.
Store injected at startup via `set_store()`; routes 503 until wired.

---

## Entry Snapshot Contents

Each `TradeEntrySnapshot` captures 12 components:

1. **TradeBasics** — trade_id, symbol, side, fill price/size, leverage, SL/TP, fees
2. **TriggerContext** — what caused the entry (scanner, ML signal, manual)
3. **MLSnapshot** — all 14 condition model outputs, composite score, direction model
4. **MarketState** — L2 book, spread, depth, price changes, realized vol
5. **DerivativesState** — funding rate, OI, OI z-score
6. **LiquidationTerrain** — cascade active flag, liq clusters
7. **OrderFlowState** — CVD 30m/1h + acceleration, buy/sell ratios, large-trade count (phase 2 Amendment 10 — all populated from data-layer)
8. **SmartMoneyContext** — HLP net/side/size, top whales, sm_changes open-count (phase 2 Amendment 10 — populated from data-layer)
9. **TimeContext** — hour UTC, day of week, trading session
10. **AccountContext** — portfolio value, daily PnL, open positions
11. **SettingsSnapshot** — SHA256 hash of active trading_settings.json
12. **PriceHistoryContext** — last 15 1m candles + last 48 5m candles

## Lifecycle Events

Emitted at every mechanical state mutation during a trade hold:

| Event Type | When |
|------------|------|
| `peak_roe_new` | Peak ROE reaches new high |
| `trough_roe_new` | Trough ROE reaches new low |
| `dynamic_sl_placed` | Dynamic protective SL placed after position detection |
| `fee_be_set` | Fee-breakeven SL set when ROE clears fee threshold |
| `trail_activated` | Trailing stop activated at vol-regime threshold |
| `trail_updated` | Trailing stop price tightened |
| `vol_regime_change` | Vol regime transitions (e.g., normal → high) |
| `trade_exit` | Position closed by any exit path |

## Counterfactuals

Computed after trade exit with a deferred recomputation pass:

- **Immediate** (at exit): MFE/MAE from hold-period candles, optimal exit within hold
- **Deferred** (30-min daemon check via `list_exit_snapshots_needing_counterfactuals` + `update_exit_snapshot`): did TP hit post-exit? Was SL hunted (touch then >1% reversal)?

---

## Integration Points

- **daemon.py** — initializes `JournalStore` at startup (auto-runs one-shot staging→journal migration if staging.db exists), emits lifecycle events at mutation points, runs `_recompute_pending_counterfactuals()` every 30 minutes
- **trading.py** — calls `build_entry_snapshot()` after every order fill and persists via `_journal_store.insert_entry_snapshot()`
- **daemon.py exit path** — calls `build_exit_snapshot()` + `insert_exit_snapshot()` before position eviction on trigger close
- **dashboard/dashboard.py** — creates a second `JournalStore` instance at startup for read-only API serving; Phase 3 analysis agent will write from another thread

---

## Testing

Unit tests: `tests/unit/test_v2_journal.py` (37 tests covering reconstruction
helpers, JournalStore CRUD, embedding client, cosine similarity, semantic
search, metadata, Amendment 10 order flow + smart money backfill).

Integration tests: `tests/integration/test_v2_journal_integration.py` (17
tests covering FastAPI routes via `TestClient`, WAL concurrency, migration
roundtrips, end-to-end capture populating Amendment 10 fields).

Data-layer tests: `data-layer/tests/test_order_flow.py` (+3 new tests
covering the 30m window and `large_trade_count` helper).

---

*Last updated: 2026-04-12 (phase 2 complete — M1–M8)*
