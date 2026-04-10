# Phase 7 — Dashboard Rework

> **Prerequisites:** Phases 0–6 complete. The journal + analysis + consolidation are fully wired. The dashboard is still on v1 state (using `/api/nous/*` routes that no longer have a backend since phase 4).
>
> **Phase goal:** Delete the dashboard pages that no longer make sense (memory, graph, brain, regret tab). Rework the Journal page into the primary destination for v2 transparency: rich trade detail views showing narrative + evidence + lifecycle + counterfactuals, pattern browser, filters. Rewire API routes from `/api/nous/*` to `/api/v2/journal/*`. Trim `state.py` aggressively.

---

## Context

This is the longest phase because of the sheer LOC in `dashboard/dashboard/state.py` (3,947 lines verified) and the need to rewrite the Journal page as the central v2 UI surface.

Per the research agent's inventory, the following state var categories exist in `state.py`:
- Auth/Session (3 vars)
- Chat/Messages (8 vars)
- Portfolio/Positions (5 vars)
- Daemon State (15 vars)
- Memory/Nous-related (22+ vars including cluster_displays, conflict_items, stale_html, memory_node_count, memory_edge_count, watchpoint_groups, etc.)
- Journal/Trading (25+ vars)
- Regime State (12 vars)
- Wallet/Cost (16 vars)
- Scanner (5 vars)
- Wake Feed (9 vars)
- Trading Settings (60+ vars)
- UI State (~10 vars)

Phase 7 cuts everything in Memory/Nous-related + the watchpoint groups + the cluster backfill state. It cuts the Regret tab state vars and keeps only the Trades tab state. It expands the Trades tab state with new v2 fields (analysis narrative, findings, grades, mistake tags). It deletes the memory/graph pages entirely and replaces them with enhanced Journal.

---

## Required Reading

1. All prior phase plans
2. **`dashboard/dashboard/state.py`** — full read, with the inventory from research agent fresh in mind
3. **`dashboard/dashboard/pages/journal.py`** — the current journal page (1033 lines)
4. **`dashboard/dashboard/pages/memory.py`** — page to delete
5. **`dashboard/dashboard/pages/graph.py`** — page to delete
6. **`dashboard/dashboard/dashboard.py`** — entry point and API proxy routes
7. **`dashboard/dashboard/components/`** — shared components you may reuse
8. **`src/hynous/journal/api.py`** — the v2 API you're consuming

---

## Scope

### In Scope

- Delete `dashboard/dashboard/pages/memory.py`
- Delete `dashboard/dashboard/pages/graph.py`
- Delete `dashboard/assets/brain.html`
- Delete `dashboard/assets/graph.html`
- Rework `dashboard/dashboard/pages/journal.py` as the v2 Journal page
- Trim `dashboard/dashboard/state.py`:
  - Remove all Nous-related state vars and methods
  - Remove Regret tab state (phantom_records, playbook_records)
  - Remove watchpoint state (watchpoint_groups, cluster_displays)
  - Remove decay/backfill/conflict state
  - Add new v2 state vars for journal
- Remove routes from `dashboard/dashboard/dashboard.py`:
  - `/api/nous/{path:path}` proxy
  - Related mount code
- Update `dashboard/dashboard/dashboard.py` navigation:
  - Remove Memory and Graph nav entries
  - Keep Home, Chat, Journal, Data, ML, Settings, Debug, Login
- Consolidate settings state vars into a dict-based pattern (optional improvement, but recommended)
- Delete home page's "tools dialog" since memory tools no longer exist

### Out of Scope

- Chat page rewrite (user chat agent is separate; keep chat page using the current chat flow, swap backend to user_chat agent)
- Debug page changes (keep as-is)
- ML page changes (keep as-is)
- Data page changes (keep as-is)
- Settings page rewrite beyond removing settings vars for deleted features
- Dashboard styling theme changes

---

## Deletion Phase

### Step 1 — Delete pages

```bash
rm dashboard/dashboard/pages/memory.py
rm dashboard/dashboard/pages/graph.py
rm dashboard/assets/brain.html
rm dashboard/assets/graph.html
```

Update `dashboard/dashboard/dashboard.py`:
- Remove imports: `from .pages.memory import memory_page`, `from .pages.graph import graph_page`
- Remove route registrations for `/memory` and `/graph`
- Remove nav items from the nav component (`dashboard/dashboard/components/nav.py`)

### Step 2 — Trim state.py

Identified v1 state vars to delete (with line numbers from research):

**Delete these vars entirely:**

- `cluster_displays` (2561)
- `cluster_total` (2562)
- `watchpoint_groups` (2464)
- `watchpoint_count` (2465)
- `memory_node_count` (2696)
- `memory_edge_count` (2697)
- `memory_health_ratio` (2698)
- `memory_lifecycle_html` (2699)
- `conflict_items` (2701)
- `conflict_count` (2702)
- `show_conflicts` (2703)
- `stale_html` (2705)
- `stale_count` (2706)
- `stale_filter` (2707)
- `show_stale` (2708)
- `decay_running` (2710)
- `decay_result` (2711)
- `backfill_running` (2713)
- `backfill_result` (2714)
- `cluster_backfill_running` (2716)
- `cluster_backfill_result` (2717)
- `memory_unread` (756)
- `news_expanded` (762)
- `clusters_sidebar_expanded` (763)
- `regret_missed_count` (3190)
- `regret_good_pass_count` (3191)
- `regret_miss_rate` (3192)
- `regret_miss_rate_high` (3193)
- `regret_phantoms` (3194)
- `regret_playbooks` (3195)
- `journal_expanded_phantoms` (3197)
- `journal_show_all_phantoms` (3199)

**Delete these methods entirely:**

- `_fetch_watchpoints()` (2476-2557)
- `_fetch_clusters()` (2573-2660)
- `_fetch_memory_health()` (2749-2804)
- `_fetch_conflicts()` (2807-2861)
- `_fetch_stale()` (2864-2908)
- `_fetch_regret_data()` (3933-3947)
- `load_watchpoints()` (2467-2473)
- `load_clusters()` (2564-2570)
- `load_memory_page()` (2719-2737)
- `load_stale_filtered()` (2125-2133)
- `run_decay()` (2910-2930)
- `run_backfill()` (2941-2955)
- `run_cluster_backfill()` (2966-2983)
- `resolve_all_conflicts()` (3049-3064)
- `resolve_all_keep_both()` (3066-3076)
- `bulk_archive_stale()` (3088-3104)
- `_exec_resolve_one()` (3147-3161)
- `resolve_one_conflict()` (3143-3145)
- `_enrich_trade()` (all Nous-based enrichment logic; replaced by journal fetch)

**Delete these navigation methods:**

- `go_to_memory()` — navigation to deleted page
- `go_to_graph()` — navigation to deleted page

Modify `load_page()` to no longer call `load_memory_page`, `load_watchpoints`, or `load_clusters`. Keep `load_journal()` but rewrite it per step 3.

Update `poll_portfolio()` to remove cluster/watchpoint/memory health refresh calls that were firing every 60s.

Run `wc -l dashboard/dashboard/state.py` before and after. Expect reduction from ~3947 to ~2500-2800 lines.

### Step 3 — Delete API proxy route

In `dashboard/dashboard/dashboard.py`, delete the `/api/nous/{path:path}` proxy route (around line 296). No longer needed because Nous is gone.

---

## Rework Phase

### Step 4 — Add v2 state vars

In `dashboard/dashboard/state.py`, add these new state vars (categorized):

```python
# v2 Journal state
journal_trades: list[TradeRow] = []                    # list of trade summaries
journal_selected_trade_id: str = ""                    # currently opened trade detail
journal_selected_trade_detail: dict = {}               # full bundle of selected trade
journal_selected_trade_events: list[dict] = []         # lifecycle events
journal_selected_trade_analysis: dict = {}             # analysis record with citations
journal_selected_trade_related: list[dict] = []        # edges from consolidation
journal_filter_status: str = "all"                     # "all" | "closed" | "rejected" | "analyzed"
journal_filter_exit_classification: str = "all"        # filter by exit type
journal_filter_since: str = ""                         # ISO date
journal_filter_until: str = ""                         # ISO date
journal_filter_text: str = ""                          # semantic search text
journal_stats: dict = {}                               # aggregate stats panel data
journal_patterns: list[dict] = []                      # weekly rollup panel data
journal_view_mode: str = "list"                        # "list" | "detail" | "patterns"
journal_analysis_expanded_findings: list[str] = []     # which finding IDs are expanded in detail view
journal_analysis_rerun_pending: bool = False           # UI flag for manual re-analyze
```

Define the `TradeRow` type:

```python
class TradeRow(rx.Base):
    trade_id: str
    symbol: str
    side: str
    status: str
    entry_ts: str
    exit_ts: str
    entry_px: float
    exit_px: float
    realized_pnl_usd: float
    roe_pct: float
    hold_duration_s: int
    exit_classification: str
    process_quality_score: int     # from analysis if present, else 0
    mistake_tags_csv: str           # comma-joined for display
    one_line_summary: str           # from analysis
```

### Step 5 — Add v2 fetcher methods

In `state.py`, add:

```python
@_background
async def load_journal_v2(self):
    """Fetch journal data from /api/v2/journal/* endpoints."""
    async with self:
        filter_status = self.journal_filter_status
        filter_classification = self.journal_filter_exit_classification
        filter_since = self.journal_filter_since
        filter_until = self.journal_filter_until
    
    # Fetch trades
    params = {}
    if filter_status != "all":
        params["status"] = filter_status
    if filter_classification != "all":
        params["exit_classification"] = filter_classification
    if filter_since:
        params["since"] = filter_since
    if filter_until:
        params["until"] = filter_until
    
    trades_data = await asyncio.to_thread(
        _fetch_v2_journal_trades, params
    )
    stats_data = await asyncio.to_thread(
        _fetch_v2_journal_stats, {}
    )
    patterns_data = await asyncio.to_thread(
        _fetch_v2_journal_patterns
    )
    
    async with self:
        self.journal_trades = [TradeRow(**t) for t in trades_data]
        self.journal_stats = stats_data
        self.journal_patterns = patterns_data


@_background
async def select_trade(self, trade_id: str):
    """Load full detail bundle for a trade."""
    async with self:
        self.journal_selected_trade_id = trade_id
        self.journal_view_mode = "detail"
    
    detail = await asyncio.to_thread(_fetch_v2_journal_trade, trade_id)
    related = await asyncio.to_thread(_fetch_v2_journal_related, trade_id)
    
    async with self:
        self.journal_selected_trade_detail = detail
        self.journal_selected_trade_events = detail.get("events", [])
        self.journal_selected_trade_analysis = detail.get("analysis", {})
        self.journal_selected_trade_related = related


@_background
async def search_journal(self, query: str):
    """Semantic search over journal."""
    async with self:
        self.journal_filter_text = query
    
    results = await asyncio.to_thread(_fetch_v2_journal_search, query)
    # Convert semantic search results to trade rows by loading each
    trades = []
    for r in results[:50]:
        detail = await asyncio.to_thread(_fetch_v2_journal_trade, r["trade_id"])
        if detail:
            trades.append(TradeRow(
                trade_id=detail["trade_id"],
                symbol=detail["symbol"],
                side=detail["side"],
                status=detail["status"],
                entry_ts=detail.get("entry_ts") or "",
                exit_ts=detail.get("exit_ts") or "",
                entry_px=detail.get("entry_px") or 0,
                exit_px=detail.get("exit_px") or 0,
                realized_pnl_usd=detail.get("realized_pnl_usd") or 0,
                roe_pct=detail.get("roe_pct") or 0,
                hold_duration_s=detail.get("hold_duration_s") or 0,
                exit_classification=detail.get("exit_classification") or "",
                process_quality_score=(detail.get("analysis") or {}).get("process_quality_score", 0),
                mistake_tags_csv=",".join((detail.get("analysis") or {}).get("mistake_tags", [])),
                one_line_summary=(detail.get("analysis") or {}).get("one_line_summary", ""),
            ))
    
    async with self:
        self.journal_trades = trades


@_background
async def rerun_analysis(self, trade_id: str):
    """Manually re-trigger the analysis agent for a trade."""
    async with self:
        self.journal_analysis_rerun_pending = True
    
    await asyncio.to_thread(_rerun_v2_analysis, trade_id)
    
    # Refresh the detail view
    await self.select_trade(trade_id)
    
    async with self:
        self.journal_analysis_rerun_pending = False


def set_journal_view_mode(self, mode: str):
    self.journal_view_mode = mode
    if mode == "list":
        self.journal_selected_trade_id = ""
        self.journal_selected_trade_detail = {}


def set_journal_filter_status(self, status: str):
    self.journal_filter_status = status
    # Trigger reload (event-driven)
    return AppState.load_journal_v2


def toggle_finding_expanded(self, finding_id: str):
    if finding_id in self.journal_analysis_expanded_findings:
        self.journal_analysis_expanded_findings.remove(finding_id)
    else:
        self.journal_analysis_expanded_findings.append(finding_id)
```

Helper functions for HTTP calls:

```python
# At module level in state.py

def _fetch_v2_journal_trades(params: dict) -> list[dict]:
    import requests
    try:
        resp = requests.get(
            "http://localhost:8000/api/v2/journal/trades",
            params=params,
            timeout=5,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        logger.exception("Failed to fetch v2 journal trades")
        return []


def _fetch_v2_journal_trade(trade_id: str) -> dict:
    import requests
    try:
        resp = requests.get(
            f"http://localhost:8000/api/v2/journal/trades/{trade_id}",
            timeout=5,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        logger.exception("Failed to fetch v2 journal trade %s", trade_id)
        return {}


def _fetch_v2_journal_related(trade_id: str) -> list[dict]:
    import requests
    try:
        resp = requests.get(
            f"http://localhost:8000/api/v2/journal/trades/{trade_id}/related",
            timeout=5,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return []


def _fetch_v2_journal_stats(params: dict) -> dict:
    import requests
    try:
        resp = requests.get(
            "http://localhost:8000/api/v2/journal/stats",
            params=params,
            timeout=5,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return {}


def _fetch_v2_journal_patterns() -> list[dict]:
    import requests
    try:
        resp = requests.get(
            "http://localhost:8000/api/v2/journal/patterns",
            params={"limit": 5},
            timeout=5,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return []


def _fetch_v2_journal_search(query: str) -> list[dict]:
    import requests
    try:
        resp = requests.get(
            "http://localhost:8000/api/v2/journal/search",
            params={"q": query, "scope": "entry", "limit": 50},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return []


def _rerun_v2_analysis(trade_id: str) -> None:
    import requests
    try:
        requests.post(
            f"http://localhost:8000/api/v2/journal/analyze/{trade_id}",
            timeout=60,
        )
    except Exception:
        logger.exception("Re-analyze failed for %s", trade_id)
```

### Step 6 — Rewrite journal.py page

Replace the entire file with a v2-focused version.

```python
# dashboard/dashboard/pages/journal.py

import reflex as rx
from ..state import AppState
from ..components.card import card, stat_card


def journal_page() -> rx.Component:
    """v2 Journal — primary destination for trade transparency."""
    return rx.box(
        _header_stats(),
        _filters_bar(),
        rx.cond(
            AppState.journal_view_mode == "detail",
            _trade_detail_view(),
            rx.cond(
                AppState.journal_view_mode == "patterns",
                _patterns_view(),
                _trade_list_view(),
            ),
        ),
        padding="1.5rem",
    )


def _header_stats() -> rx.Component:
    """Top bar with aggregate stats."""
    return rx.hstack(
        stat_card(AppState.journal_stats["win_rate"].to_string() + "%", "Win Rate"),
        stat_card("$" + AppState.journal_stats["total_pnl"].to_string(), "Total PnL"),
        stat_card(AppState.journal_stats["profit_factor"].to_string(), "Profit Factor"),
        stat_card(AppState.journal_stats["total_trades"].to_string(), "Trades"),
        stat_card(AppState.journal_stats["avg_hold_s"].to_string() + "s", "Avg Hold"),
        spacing="4",
        width="100%",
    )


def _filters_bar() -> rx.Component:
    """Filters and view mode toggles."""
    return rx.hstack(
        rx.select(
            ["all", "closed", "rejected", "analyzed", "open"],
            default_value="all",
            on_change=AppState.set_journal_filter_status,
        ),
        rx.select(
            ["all", "trailing_stop", "breakeven_stop", "dynamic_protective_sl", "tp_hit", "manual_close", "liquidation"],
            default_value="all",
            on_change=AppState.set_journal_filter_exit_classification,
        ),
        rx.input(
            placeholder="Semantic search...",
            on_blur=AppState.search_journal,
        ),
        rx.button("List", on_click=lambda: AppState.set_journal_view_mode("list")),
        rx.button("Patterns", on_click=lambda: AppState.set_journal_view_mode("patterns")),
        spacing="2",
        padding_y="1rem",
    )


def _trade_list_view() -> rx.Component:
    """Sortable table of trades."""
    return rx.vstack(
        rx.foreach(AppState.journal_trades, _trade_row),
        spacing="1",
        width="100%",
    )


def _trade_row(trade: rx.Var) -> rx.Component:
    """Single row in the trade list. Click to open detail."""
    return rx.box(
        rx.hstack(
            rx.text(trade.symbol, font_weight="bold"),
            rx.text(trade.side, color=rx.cond(trade.side == "long", "#4ade80", "#f87171")),
            rx.text(trade.entry_ts[:16]),
            rx.text("$" + trade.entry_px.to_string()),
            rx.text("→ $" + trade.exit_px.to_string()),
            rx.text(trade.roe_pct.to_string() + "%"),
            rx.text(trade.exit_classification),
            rx.cond(
                trade.process_quality_score > 0,
                rx.text("Grade: " + trade.process_quality_score.to_string()),
                rx.text(""),
            ),
            rx.text(trade.one_line_summary, color="#888"),
            spacing="4",
        ),
        padding="0.5rem",
        border_bottom="1px solid #222",
        cursor="pointer",
        on_click=lambda: AppState.select_trade(trade.trade_id),
        _hover={"background": "#111"},
    )


def _trade_detail_view() -> rx.Component:
    """Full trade detail with lifecycle, analysis, evidence, related trades."""
    return rx.vstack(
        rx.button("← Back to list", on_click=lambda: AppState.set_journal_view_mode("list")),
        _trade_summary_panel(),
        _trade_narrative_with_citations(),
        _trade_grades_panel(),
        _trade_mistake_tags(),
        _trade_findings_list(),
        _trade_events_timeline(),
        _trade_related_panel(),
        rx.button(
            "Re-analyze",
            on_click=lambda: AppState.rerun_analysis(AppState.journal_selected_trade_id),
            loading=AppState.journal_analysis_rerun_pending,
        ),
        spacing="4",
    )


def _trade_summary_panel() -> rx.Component:
    """Top panel: symbol, entry/exit, PnL, etc."""
    detail = AppState.journal_selected_trade_detail
    return card(
        rx.vstack(
            rx.heading(detail["symbol"] + " " + detail["side"]),
            rx.text("Entry: $" + detail["entry_px"].to_string() + " at " + detail["entry_ts"]),
            rx.text("Exit: $" + detail["exit_px"].to_string() + " at " + detail["exit_ts"]),
            rx.text("PnL: $" + detail["realized_pnl_usd"].to_string()),
            rx.text("ROE: " + detail["roe_pct"].to_string() + "%"),
            rx.text("Classification: " + detail["exit_classification"]),
        ),
    )


def _trade_narrative_with_citations() -> rx.Component:
    """LLM narrative with inline citations to findings."""
    analysis = AppState.journal_selected_trade_analysis
    return card(
        rx.vstack(
            rx.heading("Analysis", size="4"),
            rx.text(analysis.get("narrative", "No analysis yet.")),
            # Citations: each paragraph has a finding_ids list; render as chips
            # Full implementation: engineer iterates narrative_citations and shows
            # a chip per finding_id that opens the finding detail on click.
        ),
    )


def _trade_grades_panel() -> rx.Component:
    """Six component grades as horizontal bars."""
    grades = AppState.journal_selected_trade_analysis.get("grades", {})
    return card(
        rx.vstack(
            rx.heading("Grades", size="4"),
            _grade_bar("Entry Quality", grades.get("entry_quality_grade", 0)),
            _grade_bar("Entry Timing", grades.get("entry_timing_grade", 0)),
            _grade_bar("SL Placement", grades.get("sl_placement_grade", 0)),
            _grade_bar("TP Placement", grades.get("tp_placement_grade", 0)),
            _grade_bar("Size/Leverage", grades.get("size_leverage_grade", 0)),
            _grade_bar("Exit Quality", grades.get("exit_quality_grade", 0)),
            rx.text("Process Quality: " + AppState.journal_selected_trade_analysis.get("process_quality_score", 0).to_string() + "/100"),
        ),
    )


def _grade_bar(label: str, value) -> rx.Component:
    return rx.hstack(
        rx.text(label, width="120px"),
        rx.box(
            background=rx.cond(value >= 70, "#4ade80", rx.cond(value >= 40, "#fbbf24", "#f87171")),
            width=value.to_string() + "%",
            height="12px",
            border_radius="4px",
        ),
        rx.text(value.to_string()),
    )


def _trade_mistake_tags() -> rx.Component:
    tags = AppState.journal_selected_trade_analysis.get("mistake_tags", [])
    return card(
        rx.vstack(
            rx.heading("Mistake Tags", size="4"),
            rx.hstack(rx.foreach(tags, _tag_chip)),
        ),
    )


def _tag_chip(tag) -> rx.Component:
    return rx.text(
        tag,
        padding="0.25rem 0.5rem",
        background="#222",
        border_radius="4px",
        font_size="0.8rem",
    )


def _trade_findings_list() -> rx.Component:
    """Expandable list of findings with evidence."""
    findings = AppState.journal_selected_trade_analysis.get("findings", [])
    return card(
        rx.vstack(
            rx.heading("Findings (evidence)", size="4"),
            rx.foreach(findings, _finding_row),
        ),
    )


def _finding_row(finding) -> rx.Component:
    """One finding with interpretation + evidence values when expanded."""
    return rx.box(
        rx.hstack(
            rx.text(finding["id"], font_weight="bold", font_family="monospace"),
            rx.text(finding["type"]),
            rx.text(finding["severity"]),
            rx.text(finding["interpretation"], color="#aaa"),
        ),
        # Full implementation: click to expand, show evidence_values JSON
        padding="0.5rem",
        border_left=rx.cond(
            finding["severity"] == "high",
            "3px solid #f87171",
            rx.cond(finding["severity"] == "medium", "3px solid #fbbf24", "3px solid #4ade80"),
        ),
        padding_left="1rem",
        margin_bottom="0.5rem",
    )


def _trade_events_timeline() -> rx.Component:
    """Lifecycle events in chronological order."""
    events = AppState.journal_selected_trade_events
    return card(
        rx.vstack(
            rx.heading("Lifecycle", size="4"),
            rx.foreach(events, _event_row),
        ),
    )


def _event_row(event) -> rx.Component:
    return rx.hstack(
        rx.text(event["ts"], font_size="0.8rem", color="#888"),
        rx.text(event["event_type"], font_weight="bold"),
        # Show key payload fields
    )


def _trade_related_panel() -> rx.Component:
    """Related trades via consolidation edges."""
    related = AppState.journal_selected_trade_related
    return card(
        rx.vstack(
            rx.heading("Related Trades", size="4"),
            rx.foreach(related, _related_row),
        ),
    )


def _related_row(item) -> rx.Component:
    return rx.hstack(
        rx.text(item["edge_type"]),
        rx.text(item["other_id"]),
        rx.text(item["reason"], color="#aaa"),
        on_click=lambda: AppState.select_trade(item["other_id"]),
        cursor="pointer",
    )


def _patterns_view() -> rx.Component:
    """Weekly pattern rollups."""
    return rx.vstack(
        rx.heading("System Health Reports"),
        rx.foreach(AppState.journal_patterns, _pattern_card),
    )


def _pattern_card(pattern) -> rx.Component:
    return card(
        rx.vstack(
            rx.heading(pattern["title"], size="4"),
            rx.text(pattern["description"]),
            # Render the aggregate breakdown: mistake tag histogram, rejection reasons, grades
            # Engineer implements the detail rendering based on aggregate JSON structure
        ),
    )
```

### Step 7 — Home page cleanup

Open `dashboard/dashboard/pages/home.py`. Remove:
- Tools dialog (50+ tools with color mappings) — references deleted tools
- Memory count displays
- Phantom/regret panels if present

Simplify to a minimal portfolio overview + agent status + link to Journal.

### Step 8 — Navigation update

In `dashboard/dashboard/components/nav.py`:
- Remove Memory and Graph nav items
- Keep: Home, Chat, Journal, Data, ML, Settings, Debug, Login

---

## Testing

### Smoke tests

1. **Dashboard boots without errors**: `cd dashboard && reflex run`, navigate to all pages, no 404 or import errors
2. **Journal page loads**: navigate to `/journal`, verify list renders
3. **Trade detail opens**: click a trade, verify detail view renders with narrative + findings + events
4. **Search works**: enter a query, verify results update
5. **Filters work**: change status/classification filter, verify list updates
6. **Patterns view loads**: click Patterns tab, verify pattern cards render
7. **Re-analyze works**: click re-analyze, verify the analysis refreshes

### Regression

All remaining pages (home, chat, data, ml, settings, debug, login) must still load without errors. Navigate each and verify no console errors.

---

## Acceptance Criteria

- [ ] Memory, graph pages deleted
- [ ] brain.html, graph.html assets deleted
- [ ] state.py trimmed to ≤ 2800 lines (from 3947)
- [ ] All Nous-related state vars + methods removed
- [ ] Regret tab state removed
- [ ] New v2 journal state vars added
- [ ] New v2 fetcher methods implemented
- [ ] journal.py page rewritten to use v2 API
- [ ] Home page tools dialog removed
- [ ] Nav component updated (8 items total)
- [ ] `/api/nous/{path}` proxy removed from dashboard.py
- [ ] All v2 smoke tests pass
- [ ] No console errors on any page
- [ ] Regression: home, chat, data, ml, settings, debug, login still load
- [ ] Phase 7 commits tagged `[phase-7]`

---

## Report-Back

Include:
- state.py line count before and after
- List of deleted methods (grep your diff)
- Screenshot or description of the new Journal page layout
- Any Reflex-specific issues hit during the rewrite
- Any endpoints that needed adjustment in `src/hynous/journal/api.py`
