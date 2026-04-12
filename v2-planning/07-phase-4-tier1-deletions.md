# Phase 4 — Tier 1 Deletions

> **Prerequisites:** Phases 0, 1, 2, 3 complete and accepted. At this point, the v2 journal is live, the analysis agent is producing evidence-backed records, but the v1 decision-injection layer (Nous, coach, consolidation, retrieval orchestrator, memory manager, playbook matcher, trade_history, wake_warnings, context_snapshot as injector) is still present and firing in parallel.
>
> **Phase goal:** Delete the v1 decision-injection layer. After this phase, Nous is gone (server, client, TypeScript code, systemd service), the LLM-in-the-loop memory tools are deleted, and the daemon no longer has any reference to the old memory or coach code paths. The codebase is significantly lighter.

---

## Context

Phase 4 is the biggest net LOC delete of the v2 refactor. It removes everything that was verified as "not load-bearing for trading" during the research audit. By now:

- The journal + analysis agent are populating `trade_analyses` with evidence-backed output
- The dashboard is still on `/api/nous/*` — that's fine; phase 7 switches it
- Phase 5 will then refactor `execute_trade` to be mechanical; but phase 4 cleans the ground first

Deletion order matters. You cannot delete a module while another module still imports from it. The plan below is ordered to maintain a compiling codebase at every step.

---

## Required Reading

1. **`03-phase-0-branch-and-environment.md`** — understand what's v2 scaffolding (keep) vs v1 legacy (delete)
2. **`04-phase-1-data-capture.md`** — the new capture layer that replaces `_store_trade_memory`
3. **`05-phase-2-journal-module.md`** — the journal that replaces Nous
4. **`06-phase-3-analysis-agent.md`** — the analysis agent that replaces coach + consolidation
5. **Every file listed in "Files to delete" below** — you MUST read each file before deleting it to confirm your understanding of what it does
6. **`CLAUDE.md`** project conventions — specifically the "Tools need system prompt mention" rule (applies in reverse: if you delete a tool, you must delete its prompt mention too)

---

## Scope

### In Scope

- Delete the Nous TypeScript server entirely (`nous-server/` directory)
- Delete the Python Nous client (`src/hynous/nous/` directory)
- Delete the 8 agent tools that support memory (memory, delete_memory, explore_memory, clusters, conflicts, pruning, watchpoints, trade_stats)
- Delete the decision-injection Python modules listed below
- Remove all imports of deleted modules from the daemon, agent, prompts, trading tool
- Remove the `_store_trade_memory` call path from `trading.py`
- Remove the periodic cron jobs that support decay, conflicts, embeddings backfill, consolidation, fading memories, curiosity wakes
- Remove Nous reference in `config/default.yaml`, `core/config.py`, `deploy/` services
- Remove cost tracking for deleted tools
- Delete tests that test deleted code
- Update the system prompt (prompts/builder.py) to remove all memory tool mentions, consolidation mentions, coach mentions
- Remove CryptoCompareProvider (already identified as unused)
- Remove unused Coinglass methods
- Stop and disable the `nous.service` systemd unit (deploy change)

### Out of Scope

- Deleting v1 mechanical exit code (kept — unchanged in v2)
- Modifying `execute_trade`'s gates (phase 5 does that)
- Dashboard page deletions (phase 7)
- Tick-system satellite deletions (phase 8)
- Changing `paper.py` or `hyperliquid.py` providers
- Changing scanner or regime modules (kept for phase 5 mechanical entry)

---

## Deletion Order

This order guarantees a compiling codebase at every commit. Each step is a separate commit with `[phase-4]` tag.

### Step 1 — Remove imports & calls from trading.py (do not delete files yet)

In `src/hynous/intelligence/tools/trading.py`:

**Remove the `_store_trade_memory` call** (lines ~1183-1195 and lines ~1064-1069). Replace with no-op comment:

```python
# v1 Nous memory store removed — phase 1 journal capture handles all trade persistence
```

**Remove the Phase 3 entry_snapshots direct insert** (lines ~1197-1228). This data is now captured by the journal module in phase 1. The old satellite.db table is no longer used in v2.

**Remove the coach pre-mortem block** (lines ~978-992). Replace with comment:

```python
# v1 coach pre-mortem removed — analysis is post-trade only in v2
```

**Remove the trade_history.get_trade_warnings call** (lines ~949-960). Replace with comment:

```python
# v1 trade_history warnings removed — analysis agent now surfaces patterns post-hoc
```

**Remove imports** of `trade_history`, `coach`, nous client, `_store_trade_memory`, `_find_trade_entry`, `_store_to_nous`, `_link_theses`, `_strengthen_trade_edge`, `_update_playbook_metrics`. Keep imports of `daemon`, `config`, `request_tracer`, `trading_settings`, `context_snapshot` if still used.

**Delete helper functions inside trading.py:** `_store_trade_memory` (line 1405-1556), `_store_to_nous` (line 1282-1377), `_find_trade_entry` (line 1377-1405), `_strengthen_trade_edge` (line 2331-2358), `_update_playbook_metrics` (line 2358-2420). Keep `_place_triggers`, `_record_trade_span`, `_check_trading_allowed`, `_get_ml_conditions`, `_get_trading_provider`, `_retry_exchange_call`, `_is_rate_limit_error`.

Run: `mypy src/hynous/intelligence/tools/trading.py` — must pass. `pytest tests/unit/test_trading*.py --ignore=tests/e2e` — must still pass (some tests may need updates in step 7).

Commit: `[phase-4] remove nous/coach/trade_history calls from trading.py`

### Step 2 — Remove decision-injection usage from daemon.py

In `src/hynous/intelligence/daemon.py`, remove imports and call sites for:

- `from .coach import Coach` (and all `self._coach` or `coach.sharpen()` / `coach.pre_mortem()` calls inside daemon)
- `from .consolidation import ...`
- `from .playbook_matcher import PlaybookMatcher` (and scanner-side playbook matching logic)
- `from .trade_history import ...`
- `from .memory_manager import ...`
- `from .retrieval_orchestrator import ...`
- `from .gate_filter import ...`
- `from .wake_warnings import build_warnings` — replace with a stub that returns `""` for now (the daemon still calls this at line ~5448; change the call to `warnings_text = ""`)
- `from .context_snapshot import ...` where used for injection; keep only if any v2 code still needs it (verify by grep; likely remove entirely)
- Nous client imports: `from hynous.nous.client import get_client`

Delete cron jobs and their scheduling code in `_loop_inner` or similar:
- `_run_decay_cycle` and related scheduling
- `_check_fading_transitions` + `_wake_for_fading_memories`
- `_check_conflicts` + `_wake_for_conflicts`
- `_check_health` for Nous specifically (keep daemon-level health check; remove Nous-specific polling)
- `_run_embedding_backfill`
- `_run_consolidation`
- `_check_curiosity` + curiosity wake scheduling
- `_check_memory_review` + memory review wake
- Playbook matching block in `_wake_for_scanner`

Delete wake methods that are no longer fired:
- `_wake_for_fading_memories` (line 4726)
- `_wake_for_conflicts` (line 5124)
- `_wake_for_conditions` if still calling coach (line 834) — may keep if refactored to use ML conditions alerts

Keep wake methods still used in v1 parallel mode:
- `_wake_for_fill`, `_wake_for_watchpoint`, `_wake_for_scanner`, `_wake_for_profit`, `_wake_for_review`

**Critical:** The `_wake_agent` method still exists and still fires for scanner/fill/review wakes. Phase 5 refactors this. Phase 4 only trims the decision-injection calls inside these wake methods.

In each remaining wake method, remove the sections that:
- Call `briefing.build_briefing` with code questions from coach
- Call `memory_manager.retrieve_context`
- Inject consolidation-derived "promoted lessons"
- Inject playbook matcher output

The wake methods should still fire the LLM agent with a simpler prompt (just the market snapshot + positions + reason for wake). Phase 5 deletes the LLM agent path entirely.

Run: `mypy src/hynous/intelligence/daemon.py` — must pass. Smoke test: daemon starts without import errors.

Commit: `[phase-4] remove decision-injection calls from daemon.py`

### Step 3 — Delete decision-injection modules

**Before deleting the module files, strip 3 lazy imports inside `src/hynous/intelligence/tools/memory.py`:**

- **Line ~414** (`_store_memory_impl`): `from ..gate_filter import check_content` — delete the import, delete the whole `if cfg.memory.gate_filter_enabled:` block (lines ~416–447). Gate is always-accept in v2 (phase 4 deletes the feature; `tools/memory.py` itself is deleted in Step 4, so this is throwaway cleanup to keep tests green during M3).
- **Line ~890** (search branch): `from ..retrieval_orchestrator import orchestrate_retrieval` — delete the import, collapse the `if orch_config.orchestrator.enabled:` / `else:` by keeping the `else` (plain `client.search(...)`) branch and removing the orchestrator branch entirely.
- **Line ~921** (post-search Hebbian): `from ..memory_manager import _strengthen_co_retrieved` — delete the import and the `_strengthen_co_retrieved(...)` call block (lines ~918–922).

After these edits, `tools/memory.py` imports clean without the 3 deleted modules. It remains functional (falls back to direct `client.search` and drops the gate + Hebbian bonuses). Step 4 deletes `tools/memory.py` outright — so this touch is scoped purely to keep the deletion commit green.

> **Why this matters:** `tools/memory.py` is a runtime path exercised by `tests/integration/test_gate_filter_integration.py`. If the 3 modules are deleted without also stripping these lazy imports, the integration test fails with `ModuleNotFoundError` at runtime (not collection), cascading failures outside the projected per-milestone allow-list.

With no remaining importers, delete these files:

```bash
rm src/hynous/intelligence/coach.py
rm src/hynous/intelligence/consolidation.py
rm src/hynous/intelligence/playbook_matcher.py
rm src/hynous/intelligence/trade_history.py
rm src/hynous/intelligence/memory_manager.py
rm src/hynous/intelligence/retrieval_orchestrator.py
rm src/hynous/intelligence/gate_filter.py
rm src/hynous/intelligence/wake_warnings.py
rm src/hynous/intelligence/context_snapshot.py   # verify no remaining imports
```

Run: `grep -r "from .coach" src/hynous/` must return nothing. Same for each deleted module.

Run: `pytest tests/ --ignore=tests/e2e` — expect some test failures for tests that reference deleted modules. Those tests get deleted in step 7.

Commit: `[phase-4] delete decision-injection modules`

### Step 4 — Delete memory agent tools

Remove tool registrations in `src/hynous/intelligence/tools/registry.py`:
- `memory`, `delete_memory`, `explore_memory`, `clusters`, `conflicts`, `pruning`, `watchpoints`, `trade_stats`

Delete tool files:

```bash
rm src/hynous/intelligence/tools/memory.py
rm src/hynous/intelligence/tools/delete_memory.py
rm src/hynous/intelligence/tools/explore_memory.py
rm src/hynous/intelligence/tools/clusters.py
rm src/hynous/intelligence/tools/conflicts.py
rm src/hynous/intelligence/tools/pruning.py
rm src/hynous/intelligence/tools/watchpoints.py
rm src/hynous/intelligence/tools/trade_stats.py
```

Also delete these tools if they have no remaining importers:
- `market_watch.py` — used monitor_signal and get_book_history; audit usage
- Leave `market.py`, `orderbook.py`, `funding.py`, `multi_timeframe.py`, `liquidations.py`, `sentiment.py`, `options.py`, `institutional.py`, `web_search.py`, `costs.py`, `data_layer.py`, `trading.py` — these may still be needed for phase 5 user chat agent

Run: `grep -r "from .memory" src/hynous/intelligence/tools/` and similar for each deleted tool. Must return nothing.

**Canonical pytest invocation (M4 and audit):**

"CE-ignored" = count of files passed to pytest via `--ignore=` flags. Single concept, single list, single number. Files whose per-test failures all trace to deleted-module imports move from the fails bucket to the CE-ignored bucket by adding them to this list.

The canonical M4 ignore list is 11 files:

1. `tests/e2e/test_live_orchestrator.py`
2. `tests/integration/test_orchestrator_integration.py`
3. `tests/unit/test_consolidation.py`
4. `tests/unit/test_gate_filter.py`
5. `tests/unit/test_intent_boost.py`
6. `tests/unit/test_retrieval_orchestrator.py`
7. `tests/unit/test_pruning.py`
8. `tests/integration/test_pruning_integration.py`
9. `tests/integration/test_gate_filter_integration.py`
10. `tests/unit/test_token_optimization.py`
11. `tests/unit/test_trade_retrieval.py`

Run:

```bash
PYTHONPATH=src pytest -q \
  --ignore=tests/e2e/test_live_orchestrator.py \
  --ignore=tests/integration/test_orchestrator_integration.py \
  --ignore=tests/unit/test_consolidation.py \
  --ignore=tests/unit/test_gate_filter.py \
  --ignore=tests/unit/test_intent_boost.py \
  --ignore=tests/unit/test_retrieval_orchestrator.py \
  --ignore=tests/unit/test_pruning.py \
  --ignore=tests/integration/test_pruning_integration.py \
  --ignore=tests/integration/test_gate_filter_integration.py \
  --ignore=tests/unit/test_token_optimization.py \
  --ignore=tests/unit/test_trade_retrieval.py \
  tests/
```

Floors: `pytest CE-ignored == 11`, registry tool count `== 17`, mypy `≤ 279`, ruff `≤ 83`. The fails floor is ratified from the actual count reported by running the command above at M4 audit.

Commit: `[phase-4] delete v1 memory agent tools (Milestone 4)`

### Step 5 — Delete Python Nous client

```bash
rm -rf src/hynous/nous/
```

Verify no remaining imports:

```bash
grep -r "from hynous.nous" src/hynous/ dashboard/ tests/
grep -r "import nous" src/hynous/ dashboard/ tests/
```

Must return nothing. If anything does, fix those files first.

Update `src/hynous/__init__.py` if it exports `nous`.

Commit: `[phase-4] delete src/hynous/nous python client`

### Step 6 — Delete Nous TypeScript server

```bash
rm -rf nous-server/
```

Update `config/default.yaml`: remove the entire `nous:` section.

Update `src/hynous/core/config.py`: delete `NousConfig` dataclass and remove `nous` field from root `Config`.

Update `deploy/nous.service`: delete this file.

Update `deploy/setup.sh` to remove references to installing pnpm, building Nous, starting nous.service.

Update `CLAUDE.md` to remove references to Nous, the 3-process architecture note, the nous systemd service. This is important — CLAUDE.md is a conventions doc for future engineers. Remove the v2 branch notice that was prepended in the `[v2-docs]` cleanup — it's no longer needed because the body now describes v2 directly.

Update `README.md` to remove Nous references and update the tech stack table. Same thing re: the v2 notice — remove it now that the body is accurate.

Update `ARCHITECTURE.md` to replace the Nous section with a pointer to `src/hynous/journal/`. Remove the v2 notice prepended in `[v2-docs]` cleanup.

**Additional documentation updates (added after phase 0 audit found these were missing from the original plan):**

Update `docs/README.md`:
- Remove the v2 notice prepended in `[v2-docs]` cleanup
- Either rewrite as a v2 documentation hub pointing at `v2-planning/` and the surviving v1 archives, OR delete entirely in favor of `v2-planning/00-master-plan.md` as the canonical entry point. Engineer picks based on what makes the navigation cleanest.

Update `docs/integration.md`:
- Remove the v2 notice prepended in `[v2-docs]` cleanup
- The current v1 content describes cross-system flows that v2 deletes (satellite ↔ data-layer historical push, Nous retrieval paths, coach/consolidation injection). Rewrite as a shorter doc describing v2's remaining cross-system flows: daemon ↔ journal (write path), daemon ↔ satellite (ML inference path), journal ↔ analysis agent (post-trade pipeline), journal ↔ dashboard (API path). OR delete if `v2-planning/04-phase-1-...md` and `v2-planning/06-phase-3-...md` cover the same ground.

Update `Makefile`:
- Fix or remove the `init-db` target — currently references `from hynous.nous import NousStore` which phase 4 is deleting. Either point it at `hynous.journal.store.JournalStore` (if v2 needs an explicit init step) or delete the target entirely (if the journal store auto-initializes on first use, which phase 2 makes it do).
- Verify the `daemon` target works — it should, because phase 1 step 0 created `scripts/run_daemon.py`.
- Remove any other targets that reference deleted modules.

Update `pyproject.toml`:
- Review the `description` field — if it mentions Nous, LLM memory graph, or the v1 architecture, rewrite to a v2-appropriate description.
- Review the `[project.dependencies]` list for Nous-specific packages that can be removed (unlikely — Nous was TypeScript — but confirm).
- Review `[project.scripts]` entries if any reference deleted modules.

Update `deploy/README.md` (if it exists):
- Currently references the 3-service systemd setup (hynous + nous + hynous-data). Phase 4 deletes `nous.service`. Update the deployment doc to describe the 2-service setup (hynous + hynous-data) with a note that the journal runs in-process.
- Update `deploy/setup.sh` to remove the `pnpm install` + `cd nous-server && pnpm build` steps.

Run: `grep -rn "nous" src/hynous/ dashboard/ config/ deploy/ --include="*.py" --include="*.yaml" --include="*.md"`. Expect only references in phase 2's comments ("replaced Nous in phase 2").

Commit: `[phase-4] delete nous TypeScript server + systemd unit + docs`

### Step 7 — Delete tests for deleted code

Tests that reference deleted modules will fail. Delete them:

```bash
rm tests/unit/test_memory*.py 2>/dev/null
rm tests/unit/test_coach*.py 2>/dev/null
rm tests/unit/test_consolidation*.py 2>/dev/null
rm tests/unit/test_gate_filter*.py 2>/dev/null
rm tests/unit/test_retrieval_orchestrator*.py 2>/dev/null
rm tests/unit/test_trade_history*.py 2>/dev/null
rm tests/unit/test_playbook_matcher*.py 2>/dev/null
rm tests/unit/test_memory_manager*.py 2>/dev/null
rm tests/unit/test_wake_warnings*.py 2>/dev/null
rm tests/unit/test_context_snapshot*.py 2>/dev/null
rm tests/unit/test_nous*.py 2>/dev/null
rm tests/unit/test_watchpoints*.py 2>/dev/null
rm tests/unit/test_clusters*.py 2>/dev/null
rm tests/unit/test_conflicts*.py 2>/dev/null
rm tests/unit/test_pruning*.py 2>/dev/null
rm tests/unit/test_explore_memory*.py 2>/dev/null
rm tests/unit/test_delete_memory*.py 2>/dev/null
rm tests/unit/test_trade_stats*.py 2>/dev/null
rm tests/integration/test_nous*.py 2>/dev/null
rm tests/integration/test_memory*.py 2>/dev/null

# Also delete these two baseline-cleanup files (see master plan amendments 2 and 3):
#
# tests/e2e/test_live_orchestrator.py — runs module-level code that requires
# Nous to be running, breaking pytest collection. Nous is gone after step 6,
# so this file's imports will fail regardless. Delete it.
rm tests/e2e/test_live_orchestrator.py 2>/dev/null

# tests/unit/test_token_optimization.py — tests v1 token optimization (TO-1
# through TO-4) which was a v1 LLM-in-the-loop prompt reduction effort.
# v2 removes the LLM from the trading loop entirely, so the feature AND the
# test are both obsolete. Has been pre-existing-failing on main for some
# time with a stale model-name assertion. Delete it.
rm tests/unit/test_token_optimization.py 2>/dev/null

# tests/unit/test_decay_conflict_fixes.py — 59 tests that directly call
# daemon methods the M2 expanded deletion set removes (`_run_decay_cycle`,
# `_check_conflicts`, `_run_embedding_backfill`, `_wake_for_fading_memories`,
# `_check_fading_transitions`, `_check_curiosity`, `_run_consolidation`)
# and assert on source text + internal state dicts (`_fading_alerted`,
# `_decay_thread`, etc.). After M2 all of these are gone. Delete here.
# NOTE: this file was added to the delete set during phase-4 execution
# after the engineer surfaced that it was testing code the plan deletes.
rm tests/unit/test_decay_conflict_fixes.py 2>/dev/null
```

**After this step the regression baseline changes:**

- **Before phase 4 (phase-3 end):** `5 failed / 920 passed / tests/e2e/test_live_orchestrator.py ignored` (use `pytest tests/ --ignore=tests/e2e/test_live_orchestrator.py`). The 5 failures are pre-existing on the v2 branch after phase 3 closed — all five are either stale-reference tests or tests that assert v1-specific behavior being replaced.
- **During M2–M5 of phase 4:** the failure count is ALLOWED TO RISE above 5 as daemon internals get deleted. Specifically `tests/unit/test_decay_conflict_fixes.py` (59 tests) and ~6 assertions inside `tests/unit/test_token_optimization.py` will start failing the moment M2 deletes their subject methods / state fields. Engineer reports the exact delta after each milestone; architect ratifies the new ceiling. No milestone may ADD failures beyond what deleted methods/fields justify.
- **After step 7 (this step):** Both offender files are gone. `pytest tests/` returns to a clean baseline of `passed / 0 failed` (exact passed-count drops by ~65 from the M1 baseline of 920 because 59 + ~6 tests were deleted; engineer reports the final number and architect pins it).

Starting with phase 5, the `--ignore=tests/e2e/test_live_orchestrator.py` flag is no longer required in any phase command because the offending file has been deleted.

Run `pytest tests/` (no `--ignore` needed now) — must pass. If any failures remain, find the root cause and fix it.

Commit: `[phase-4] delete tests for removed modules`

### Step 8 — Simplify prompts/builder.py

Replace the v1 system prompt with a minimal version. Phase 5 further minimizes this when the LLM is removed from the trading path. Phase 4 just trims what's deleted.

Edit `src/hynous/intelligence/prompts/builder.py`:

- Remove `TOOL_STRATEGY` section entirely (lines ~223-301)
- Remove `How Memory Works` section (lines ~256-272)
- Remove `Trade History Awareness` section (lines ~299-301)
- Remove `Promoted Lessons` injection (lines ~437-439) and the caller that fetches promoted lessons
- Remove references to `store_memory`, `recall_memory`, `update_memory`, `explore_memory`, `delete_memory`, `manage_watchpoints`, `manage_clusters`, `manage_conflicts`, `analyze_memory`, `batch_prune`
- Remove references to the coach, consolidation engine, playbook matcher

Keep:
- IDENTITY section (minus any memory references)
- Ground rules (sizing, risk, mechanical exits, fees)
- ML market conditions section
- The dynamic `Today` / `Mode` injections

The file should shrink from ~441 lines to ~200-250 lines. Run `wc -l src/hynous/intelligence/prompts/builder.py` before and after to verify.

Commit: `[phase-4] strip decision-injection content from system prompt`

### Step 9 — Delete unused providers

```bash
rm src/hynous/data/providers/cryptocompare.py
rm src/hynous/data/providers/perplexity.py  # if no remaining tool uses it
```

Remove `PerplexityConfig`, `CryptoCompareConfig` dataclasses from `core/config.py` (or equivalent) if present.

Remove `COINGLASS` method calls that are unused:
- Edit `src/hynous/data/providers/coinglass.py` to delete: `get_coinbase_premium`, `get_etf_flows`, `get_etf_list`, `get_oi_history_chart`, `get_exchange_balance_chart`, `get_puell_multiple`

Remove news polling from daemon.py (the CryptoCompare-backed scanner news check).

Commit: `[phase-4] delete unused providers and coinglass methods`

### Step 10 — Final cleanup

Run a comprehensive grep to catch remnants:

```bash
grep -rn "Nous\|nous_client\|NousClient\|get_client()\|\.coach\|trade_history\|memory_manager\|retrieval_orchestrator\|consolidation\|playbook_matcher\|gate_filter\|wake_warnings\|context_snapshot" src/hynous/ dashboard/ tests/ config/ --include="*.py" --include="*.yaml"
```

Remnants should only be in comments referencing the deletion. If any active code appears, remove it.

Run full test suite: `pytest tests/` (note: `--ignore=tests/e2e` no longer needed after step 7 deleted the offending file). All pass at the new baseline of `811 passed / 0 failed`.

Run mypy: `mypy src/hynous/`. Error count must be ≤ baseline.

Run ruff: `ruff check src/hynous/`. Error count must be ≤ baseline.

Commit: `[phase-4] final cleanup of deletion leftovers`

---

## Files Deleted (Summary)

| Path | Reason | Approx LOC |
|------|--------|------------|
| `nous-server/` (entire directory) | Replaced by journal module | ~91,000 TS |
| `src/hynous/nous/` | Python Nous client | ~900 |
| `src/hynous/intelligence/coach.py` | Decision-injection | ~400 |
| `src/hynous/intelligence/consolidation.py` | Decision-injection | ~600 |
| `src/hynous/intelligence/playbook_matcher.py` | Decision-injection | ~350 |
| `src/hynous/intelligence/trade_history.py` | Decision-injection | ~450 |
| `src/hynous/intelligence/memory_manager.py` | Decision-injection | ~500 |
| `src/hynous/intelligence/retrieval_orchestrator.py` | Decision-injection | ~550 |
| `src/hynous/intelligence/gate_filter.py` | Decision-injection | ~300 |
| `src/hynous/intelligence/wake_warnings.py` | Decision-injection | ~500 |
| `src/hynous/intelligence/context_snapshot.py` | Decision-injection | ~400 |
| `src/hynous/intelligence/tools/memory.py` | Memory tool | ~1100 |
| `src/hynous/intelligence/tools/delete_memory.py` | Memory tool | ~150 |
| `src/hynous/intelligence/tools/explore_memory.py` | Memory tool | ~200 |
| `src/hynous/intelligence/tools/clusters.py` | Memory tool | ~410 |
| `src/hynous/intelligence/tools/conflicts.py` | Memory tool | ~230 |
| `src/hynous/intelligence/tools/pruning.py` | Memory tool | ~670 |
| `src/hynous/intelligence/tools/watchpoints.py` | Memory tool | ~350 |
| `src/hynous/intelligence/tools/trade_stats.py` | Memory-backed stats | ~220 |
| `src/hynous/data/providers/cryptocompare.py` | Unused | ~95 |
| `src/hynous/data/providers/perplexity.py` | Unused | ~116 |
| Various Coinglass methods | Unused | ~80 |
| `deploy/nous.service` | systemd unit for deleted service | ~20 |
| Tests for deleted modules | Testing deleted code | ~3000 |
| Trimming `trading.py` (coach/history/memory calls + helpers) | Simplification | ~400 |
| Trimming `daemon.py` (cron jobs, wake refactors) | Simplification | ~600 |
| Trimming `prompts/builder.py` | Decision-injection content | ~200 |

**Total approximate LOC delete: ~15,000 Python + ~91,000 TypeScript ≈ 106,000 LOC**

---

## Testing

### Regression test

Baselines are a MOVING TARGET through phase 4, not a single pinned number. The rule is: **no deletion step introduces a failure that is NOT explained by a deleted method/state/module.** Engineer reports the count after each milestone; architect ratifies a new ceiling.

- **Through M1:** `5 failed / 920 passed` (phase-3 end baseline; preserved).
- **After M2 (daemon internals deleted):** failure count rises. Expected delta = 59 (all of `test_decay_conflict_fixes.py`) + ~6 (source-inspect assertions inside `test_token_optimization.py`) = ~65 new failures. Engineer reports exact count; architect pins `M2_ceiling = 5 + exact_delta`.
- **M3–M5:** baseline held at `M2_ceiling`. Any NEW failures must trace to code deleted in that milestone.
- **After step 7 (both offender files deleted):** baseline drops to `0 failed / N passed` where N ≈ 920 − 65 ≈ 855. Engineer reports exact; architect ratifies final phase-4 baseline.

All intermediate commands use `pytest tests/ --ignore=tests/e2e/test_live_orchestrator.py` until step 7; after step 7, plain `pytest tests/`.

After step 10, run the complete test suite with:

```bash
# After step 7 deleted the broken e2e file, plain pytest tests/ works
pytest tests/ -v --tb=short
```

Expected: all remaining tests pass, no import errors, no test collection errors.

### Static tests

```bash
mypy src/hynous/ 2>&1 | tail -1
ruff check src/hynous/ --statistics
```

Both must be at or below baseline from `v2-planning/mypy-baseline-count.txt` and `v2-planning/ruff-baseline-stats.txt`.

### Smoke test

30-minute paper mode daemon run. Verify:

- Daemon starts without import errors (critical — many things were deleted)
- No "nous" or "coach" references in the daemon log
- Journal module still receives entries on new trades
- Analysis agent still fires on trade close
- Scanner still emits wake events (though the wake now has less context)
- Mechanical exits still fire correctly (Dynamic SL, Fee-BE, Trailing v3 unchanged)

```bash
timeout 1800 python -m scripts.run_daemon 2>&1 | tee storage/v2/smoke-phase-4.log

# Verify journal still writes
sqlite3 storage/v2/journal.db "SELECT COUNT(*) FROM trades;"
sqlite3 storage/v2/journal.db "SELECT COUNT(*) FROM trade_analyses;"

# Verify no Nous references in log
grep -i "nous" storage/v2/smoke-phase-4.log
grep -i "coach\|consolidation\|playbook_matcher" storage/v2/smoke-phase-4.log
# Both must return zero results
```

### Dashboard sanity

The dashboard still uses `/api/nous/*` which now has no backend (Nous server is gone). Expected: dashboard memory/graph/brain pages are broken. This is expected and fixed in phase 7.

Verify the home and chat pages still load even if memory pages are broken.

---

## Acceptance Criteria

- [ ] 10 deletion steps executed in order, each as a separate commit
- [ ] `nous-server/` directory does not exist
- [ ] `src/hynous/nous/` directory does not exist
- [ ] All 9 decision-injection modules deleted
- [ ] All 8 memory agent tools deleted
- [ ] CryptoCompareProvider and PerplexityProvider deleted
- [ ] 6 unused Coinglass methods deleted
- [ ] `deploy/nous.service` deleted
- [ ] `config/default.yaml` has no `nous:` section
- [ ] `core/config.py` has no `NousConfig`
- [ ] `prompts/builder.py` trimmed (≥ 40% LOC reduction)
- [ ] `trading.py` trimmed: no `_store_trade_memory`, no coach calls, no trade_history calls
- [ ] `daemon.py` trimmed: no cron jobs for decay/conflicts/consolidation/fading/curiosity
- [ ] `grep "from hynous.nous"` returns nothing
- [ ] `grep "from .coach"` returns nothing (and similar for all deleted modules)
- [ ] All tests pass at the post-phase-4 baseline (`pytest tests/` = `N passed / 0 failed` where N is ratified by architect after step 7; expected in the `~855` range — the 920-baseline minus the 65 tests deleted in step 7)
- [ ] `tests/e2e/test_live_orchestrator.py` deleted
- [ ] `tests/unit/test_token_optimization.py` deleted
- [ ] `tests/unit/test_decay_conflict_fixes.py` deleted
- [ ] mypy baseline preserved
- [ ] ruff baseline preserved
- [ ] 30-minute smoke test completes without errors
- [ ] Journal and analysis still producing records during smoke test
- [ ] `CLAUDE.md`, `ARCHITECTURE.md`, `docs/README.md`, `docs/integration.md` all updated to reflect v2 (v2 branch notices removed, body rewritten or archived)
- [ ] `Makefile` `init-db` target fixed or deleted (no Nous references)
- [ ] `Makefile` `daemon` target verified working (phase 1 step 0 created `scripts/run_daemon.py`)
- [ ] `pyproject.toml` description + dependencies reviewed, v1 references removed
- [ ] `deploy/README.md` (if exists) updated from 3-service to 2-service setup
- [ ] `deploy/setup.sh` updated to remove Nous build steps
- [ ] Phase 4 commits tagged `[phase-4]`

---

## Rollback

Each step is a separate commit so rollback is granular:

```bash
git log --oneline | grep "[phase-4]"
git revert <specific-commit>
```

If the full phase needs to be reverted:

```bash
git revert <first-phase-4-commit>..<last-phase-4-commit>
```

Rollback restores Nous and all decision-injection modules. v2 then operates with both new and old systems in parallel (which is phase 3's end state).

---

## Report-Back

Include:
- Total LOC deleted (run `git diff --stat <phase-3-end-commit> HEAD`)
- Each deletion step's commit hash
- Final mypy/ruff error counts vs baseline
- Smoke test log excerpt showing journal + analysis still firing
- Any modules you found needed deleting that weren't on the list (pause and report BEFORE deleting if you find these)
- Any tests you couldn't delete because they were testing production code that was still needed
