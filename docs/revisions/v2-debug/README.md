# v2 Debug — Codebase Audit Findings

> **Generated:** 2026-04-20
> **Last updated:** 2026-04-21 — annotated each issue with RESOLVED / OPEN / BLOCKED / DEFERRED status; added Status Dashboard; 11 of 18 issues landed on `v2`.
> **Scope:** Full read-through of every Python file in `src/hynous/`, `satellite/`, `data-layer/`, `dashboard/`, `scripts/`, plus all config, deploy, and planning docs.
> **Verification status:** Every issue in this document has been verified via `grep` + `read` against the current `v2` branch. Evidence (file paths, line numbers, exact quotes) is embedded in each entry.
> **Purpose:** This document is the work-unit queue for closing v2 debt. Each issue includes enough context that another engineer can act on it without re-auditing. Nothing is speculative — claims that couldn't be verified are excluded.
>
> **Severity legend addition:** `Critical` added above `High` for actively-failing production behaviour.

---

## Status Dashboard (as of 2026-04-21)

Eighteen issues total (1 Critical + 8 High + 9 Medium). Eleven landed on `v2` in one session of cleanup commits; the remaining seven are blocked on a user decision, blocked on C1 root-cause output, or explicitly deferred per the audit's own guidance.

| ID | Severity | Status | Commit / Reason |
|----|----------|--------|-----------------|
| **C1** | Critical | **OPEN — BLOCKED on user VPS rollback** | Step 0 of Fix Order — user executes. Diagnose script run (Fix Order step 3) also pending. Trading is still halted until this resolves. |
| **H1** | High | **RESOLVED** | `b468a80` — staged_entries dead code deleted from daemon (-166 LOC); design doc archived under `docs/archive/`; mypy baseline pruned. |
| **H2** | High | **RESOLVED (strict variant)** | `ec03d27` — `src/hynous/intelligence/prompts/` deleted (builder.py + __init__.py + README.md); 4 stale prompt-introspection tests pruned from `test_ml_adaptive_trailing.py` + `test_agent_exit_lockout.py` + `test_dynamic_protective_sl.py`; 9 docs redirected from builder.py to `src/hynous/user_chat/prompt.py`. +26/-422 LOC. |
| **H3** | High | **RESOLVED** | `b10febb` — `deploy/setup.sh` installs all three services (hynous, hynous-data, hynous-daemon); all Discord references removed from `deploy/`. |
| **H4** | High | **RESOLVED** | `93dc039` — `src/hynous/README.md` rewritten for v2 layout (no discord/, no nous/). |
| **H5** | High | **RESOLVED** | `2f306f1` — `config/README.md` rewritten to match actual v2 config sections; dropped phantom `nous`/`orchestrator`/`memory`/`sections` sections; full v2 sub-config tree now documented. |
| **H6** | High | **OPEN — BLOCKED on C1 diagnose output** | Fix branches on whether v3 was trained on `best_roe_30m_net` (Hypothesis A) or `risk_adj_*` (Hypothesis B). Do not edit `scripts/retrain_direction_v3_snapshots.py` until C1 step 3 produces hard evidence. |
| **H7** | High | **RESOLVED** | `7fe866f` — `scripts/diagnose_direction_inference.py:101` default changed from `"satellite/artifacts/v3/v3"` to `"satellite/artifacts/v3"`. One-line fix unblocks C1 step 3. |
| **H8** | High | **OPEN** | No blocker. Engineer can ship anytime: add `long_target_column` + `short_target_column` to `ModelMetadata` (`satellite/training/artifact.py:27-56`), thread through `train_both_models`, update retrain scripts, backfill `metadata_v2.json` + `metadata_v3.json`. Closes the audit gap that let C1 ship unnoticed. |
| **M1** | Medium | **OPEN** | Full `context_snapshot.py` delete + dead half of `briefing.py` (`get_briefing_injection` chain) + caller cleanup in `daemon.py` / `tools/trading.py` / `regime.py`. Touches ~1800 LOC across 4 files. Audit Phase B (full `DataCache` + `build_briefing` delete) is recommended; user_chat is deliberately journal-only, no briefing resurface planned. |
| **M2** | Medium | **OPEN — BLOCKED on user decision** | Option A (keep file, fix two lying docstrings) vs Option B (rewrite 2 test files to use JournalStore, then delete `staging_store.py`). Pending user pick. |
| **M3** | Medium | **RESOLVED** | `4b229e7` — 3 dead v1 placeholder fixtures removed from `tests/conftest.py`; `tests/README.md` fixtures section rewritten. |
| **M4** | Medium | **RESOLVED** | `b0fac9f` — dead `trade_history_warnings` field deleted from `TradingSettings`. |
| **M5** | Medium | **RESOLVED** | `1a3cd82` — `TICK_FEATURE_NAMES` + `TICK_SCHEMA_VERSION` deduped; `data-layer/.../tick_collector.py` now imports from `satellite.tick_features`; shared venv via `pyproject.toml` `packages = ["src/hynous", "satellite"]` confirmed working. |
| **M6** | Medium | **RESOLVED (Option A)** | `1674f8c` — startup log line trimmed to `(price, deriv, scanner)`; v1 legacy DaemonConfig fields (11 total) left loaded-but-unused per Option A. Option B (dataclass + YAML field delete) deferred to a later config-cleanup pass if the tree ever needs leaner. |
| **M7** | Low | **DEFERRED** | Daemon monolith (now 3951 lines post-H1) split. Audit explicitly flags this as a multi-PR refactor, not cleanup. Not part of this debt-burn. |
| **M8** | Medium | **RESOLVED** | `2eb7232` — `paper.py` replaced hardcoded `TAKER_FEE = 0.00035` with `_taker_fee_per_side()` that reads `get_trading_settings().taker_fee_pct`. Runtime tuning now propagates to paper mode. |
| **M9** | Low | **DEFERRED** | `dashboard/dashboard/dashboard.py` 892-line monolith refactor. Same reasoning as M7: separate effort, not cleanup. |

**Remaining engineer work (can proceed in any order except H6):**

1. **H8** — metadata schema addition + backfill. Unblocks future retrain audits; doesn't fix C1 directly but closes the audit gap.
2. **M1** — dead briefing/context_snapshot removal. Touches daemon + trading + regime; biggest remaining cleanup.
3. **M2 Option A or B** — awaiting user decision, trivial to execute once decided.

**Remaining user-gated work (engineer cannot proceed):**

1. **C1 step 0** — rollback VPS v3 artifact (`mv satellite/artifacts/v3 v3.disabled` on VPS, `systemctl restart hynous-daemon`).
2. **C1 step 3** — run `scripts/diagnose_direction_inference.py` on v2 + v3 artifacts, share raw JSON output.
3. **C1 step 4** — pick fix branch (lower threshold vs retrain) based on diagnose output.
4. **H6** — once step 3-4 produces ground truth, engineer corrects `retrain_direction_v3_snapshots.py` targets.
5. **M2 A-vs-B** — pick docstring-only fix (A) or test-refactor-then-delete (B).

**Deferred (out of scope for this debt-burn):** M7, M9. Multi-PR refactor efforts. Start in a separate dedicated window.

---

## For the Next Engineer — Read This First

This doc has 13 issues (1 Critical, 8 High, 9 Medium). Do **not** treat it as a single burn-down. Three rules:

### 1. Some issues require human decision — surface, do not execute

- **C1 rollback to v2 artifact** — production action on VPS (SSH + systemd). Do **not** deploy autonomously. Recommend the rollback to the user and let them execute. Same rule for any `systemctl restart hynous*` or `git push origin v2` step.
- **C1 root-cause fix choice** — the fix branches *after* the diagnose script runs. Either lower `inference_entry_threshold` (if v3 was trained on `best_roe_30m_net` as commit `771ef4a` claims) or retrain with a corrected target. Report the diagnose script output; let the user pick which branch.
- **M2 staging_store resolution** — two options documented in the issue entry (Option A: fix docstring; Option B: refactor tests + delete module). Ask the user which option before touching code.
- **H6 retrain script correction** — depends on the C1 diagnose output. Do **not** edit `scripts/retrain_direction_v3_snapshots.py` until the user confirms which target column actually trained the deployed v3 artifact.

### 2. Sequencing is load-bearing — this order is non-negotiable

1. **User rolls back VPS to v2 artifact.** v3 is emitting 100% skip; entries are frozen until rollback. Not your step — flag it.
2. **You fix H7** (1-line path typo in `scripts/diagnose_direction_inference.py`). This unblocks step 3.
3. **You run the diagnose script** on the v3 artifact and report the full output to the user. Do not interpret the output into a fix — just report.
4. **User picks the C1 fix path** from that output.
5. **You ship H8** (add `target_column` to `ModelMetadata` + backfill `metadata_v2.json` / `metadata_v3.json`). Closes the audit gap that let C1 ship unnoticed.
6. **You execute the user-chosen C1 fix** (threshold lower *or* retrain). Then H6 — re-commit `retrain_direction_v3_snapshots.py` to match what actually trained v3.
7. **Cleanup batch**: H1–H5, M1, M3–M6, M8 — see groupings in the Fix Order section below. One PR per group.
8. **Deferred**: M7 (daemon monolith split) and M9 (dashboard monolith split) are separate refactor efforts, not cleanup. Do not start them as part of this debt-burn.

### 3. Scope discipline

- **One commit per issue group** (see Fix Order). Do not bundle C1 / H6 / H7 / H8 with the M-series cleanups — different review audiences, different blast radius.
- **No scope creep.** If you find new problems while fixing a listed issue, add them to this doc as new entries rather than silently fixing them in the same PR. The user reviews this doc; unlogged fixes will surprise them.
- **Every fix must include the "Verification after fix" check** from the issue entry. Don't claim done without running it.
- **Ask before deleting files that have test references.** M2 (staging_store) already has this warning; apply the same caution elsewhere.

### 4. When in doubt

- If an issue's "Proposed fix" looks ambiguous → read the Evidence block, then ask the user.
- If a fix would touch something outside the Files affected list → stop and ask.
- If the Verification step fails → do not commit. Report what failed and why.

---

## How To Read This Document

Each issue has the following fields:

- **ID** — stable identifier (H=High, M=Medium, L=Low). Reference by ID in PRs / commits.
- **Title** — one-line summary.
- **Severity** — operational impact on the running system.
  - `High` — actively broken behavior OR a deploy path that won't produce a working system.
  - `Medium` — dead code / stale docs that will mislead readers or waste runtime, but don't break anything.
  - `Low` — hygiene, minor inconsistency, cosmetic.
- **Category** — `broken-code`, `dead-code`, `stale-doc`, `dead-config`, `integrity-risk`.
- **Files affected** — all paths involved, with line numbers.
- **Evidence** — direct quotes from the current codebase proving the issue exists.
- **Impact** — what happens today vs what the code claims to do.
- **Reproduction / How it fires** — the code path that would trigger it, if any.
- **Proposed fix** — concrete action, file-by-file.
- **Verification after fix** — how to confirm the fix worked.
- **Dependencies / caveats** — anything that must happen first or be careful of.

At the end of the doc there's a **recommended fix order** section with topological dependencies.

---

## Issue Catalog

### H1 — `daemon.py` imports non-existent `staged_entries` module (dead code, silent fail)

- **Severity:** High
- **Category:** broken-code + dead-code
- **Status:** **RESOLVED 2026-04-21 in commit `b468a80`** — staged_entries field + import + gate + 3 dead methods removed from daemon.py (-166 LOC); mypy baseline stripped of the import-not-found + `_config` typo entries; design doc archived to `docs/archive/entry-quality-rework-phase-4-staged-entries.md` with a RETIRED header.

**Files affected:**
- `src/hynous/intelligence/daemon.py` (lines 316, 1822, 2600, 2603, 2607, 2613, 2619, 2659, 2662, 2663, 2695)
- `docs/revisions/entry-quality-rework/phase-4-staged-entries.md` — the design doc that specified this feature
- `docs/revisions/llm-lookahead-trade/README.md:77` — another design doc that references the deleted path
- `v2-planning/mypy-baseline.txt:248` — the mypy baseline logs this import as `import-not-found`, proving it's been broken long enough to be baselined

**Evidence:**

The daemon imports a module that does not exist anywhere in the repo:
```
src/hynous/intelligence/daemon.py:1822:            from .staged_entries import load_staged_entries
src/hynous/intelligence/daemon.py:2613:        from .staged_entries import evaluate_trigger, persist_staged_entries
```

Confirmed no source file exists:
```
$ ls src/hynous/intelligence/staged_entries.py
ls: src/hynous/intelligence/staged_entries.py: No such file or directory
```

Line 1822 is inside `_init_position_tracking()` which itself is wrapped in `try: ... except Exception as e: logger.debug(...)` at the call site in `_loop_inner`. So the `ImportError` is **silently swallowed at startup**. `self._staged_entries` defaults to `{}` and stays empty forever.

Line 2613 is inside `_evaluate_staged_entries(self, prices)`, gated by `if self._staged_entries:` at line 2600. Because `_staged_entries` is always empty (see above), this code path is unreachable.

Additionally, even if the imports worked, line 2695 has an attribute error:
```
src/hynous/intelligence/daemon.py:2695:                self._config.hyperliquid.default_slippage,
```
The correct attribute name on the `Daemon` instance is `self.config` (no underscore). Every other method in the file uses `self.config`. This is a typo that would raise `AttributeError: 'Daemon' object has no attribute '_config'` the moment the staged-entries code path fired — if it ever could.

The mypy baseline confirms this has been dormant-broken for a while:
```
v2-planning/mypy-baseline.txt:248:
  src/hynous/intelligence/daemon.py:2110:
    error: Cannot find implementation or library stub for module named
    "hynous.intelligence.staged_entries"  [import-not-found]
```

**Impact:**
- Zero runtime impact today because the try/except swallows the ImportError and the gate at line 2600 is always false.
- High audit impact: the code looks like a live feature ("staged entries" / limit-entry scheduling). A reader would assume it works. It doesn't, and hasn't been wired to anything.
- Risk: if someone ever populates `self._staged_entries` (e.g. rebuilding the feature), they'll hit the import and the `self._config` attribute error.

**Reproduction / How it fires:**
- Startup always hits line 1822 inside `_init_position_tracking()`. The ImportError is swallowed by the outer `try/except Exception` at `_loop_inner()` call site.
- Line 2600 `if self._staged_entries:` is always false, so lines 2607-2758 are dead.
- Line 1870 `if not hasattr(provider, "check_triggers") or (not self._prev_positions and not self._staged_entries):` — this guard still works because empty dict is falsy.

**Proposed fix:**

Delete the following blocks from `src/hynous/intelligence/daemon.py`:
1. Line 316: `self._staged_entries: dict = {}  # directive_id → StagedEntry` — remove the field.
2. Lines 1822-1824: the `load_staged_entries` import and `self._staged_entries = load_staged_entries(_staged_path)` assignment.
3. Line 1870: simplify `if not hasattr(provider, "check_triggers") or (not self._prev_positions and not self._staged_entries):` to `if not hasattr(provider, "check_triggers") or not self._prev_positions:` — the `_staged_entries` clause is unnecessary now.
4. Lines 2599-2605: the `# ── Staged entry evaluation ──` block that guards `_evaluate_staged_entries`.
5. Lines 2607-2754: the `_evaluate_staged_entries`, `_execute_staged_entry`, `_store_staged_trade_memory` methods in full.

Also archive (move to `docs/archive/`) the retired design:
- `docs/revisions/entry-quality-rework/phase-4-staged-entries.md` → `docs/archive/entry-quality-rework-phase-4-staged-entries.md`
- Add a header note to the archived doc: "Feature was specified but never implemented. Dead code stub in daemon.py removed YYYY-MM-DD."

Update mypy baseline to drop the import-not-found entry, then rerun `mypy src/` to confirm count matches.

**Verification after fix:**
- `grep -rn "staged_entries" src/` returns 0 matches.
- `grep -rn "_staged_entries\|_evaluate_staged\|_execute_staged_entry\|_store_staged_trade_memory" src/` returns 0 matches.
- `mypy src/hynous/ 2>&1 | grep "staged_entries"` returns 0 matches.
- `pytest tests/` still passes at baseline.

**Dependencies:** None. Purely additive deletion.

---

### H2 — `intelligence/prompts/builder.py` is dead code with a v1 autonomous-agent system prompt

- **Severity:** High (audit-facing — inaccurate description of system behavior)
- **Category:** dead-code + stale-doc
- **Status:** **RESOLVED 2026-04-21 in commit `ec03d27` (strict variant — user picked strict over lite).** The entire `src/hynous/intelligence/prompts/` directory deleted (builder.py + __init__.py + README.md). Audit missed three test files that source-read builder.py — flagged + pruned in the same commit: `TestPromptUpdated` (3 tests) in `tests/unit/test_ml_adaptive_trailing.py`, `test_system_prompt_full_exit_lockout` in `tests/unit/test_agent_exit_lockout.py`, and the unused `_builder_source` helper in `tests/unit/test_dynamic_protective_sl.py`. CLAUDE.md + ARCHITECTURE.md + 7 other doc files redirected from `prompts/builder.py` to `src/hynous/user_chat/prompt.py` (or noted that the analysis agent has its own prompt in `src/hynous/analysis/prompts.py` with no external tool surface). ruff baseline's I001 stanza for builder.py dropped. Net: +26/-422 LOC across 17 files.

**Files affected:**
- `src/hynous/intelligence/prompts/builder.py` (entire file — 245 lines)
- `src/hynous/intelligence/prompts/__init__.py` (2 lines to delete)
- `src/hynous/intelligence/prompts/README.md` (entire file)

**Evidence:**

The `build_system_prompt()` function at `builder.py:222` has no production callers. Verified via grep across `src/` and `dashboard/`:

```
src/hynous/intelligence/prompts/builder.py:222:def build_system_prompt(context: dict | None = None) -> str:
src/hynous/intelligence/prompts/__init__.py:11:    prompt = build_system_prompt(context)        # ← this is in a docstring example, not a call
src/hynous/intelligence/prompts/README.md:19: ...description of build_system_prompt...       # ← doc
```

No `build_system_prompt(` call site exists in any executable path. The dashboard references it once at `state.py:485` but only in a comment explaining a v1 method that was removed ("Phase 5 M7: the v1 ``Agent.rebuild_system_prompt()`` call that used to…").

The prompt content itself is pure v1 autonomous-agent narrative:
- `builder.py:53` — `[DAEMON WAKE` message handling rules
- `builder.py:54` — "I trust `[Briefing]` data and don't re-fetch it"
- `builder.py:36-37` — "I EXECUTE trades, I don't narrate them. Writing 'Entering SOL long' in text does NOT open a position — ONLY the execute_trade tool does."
- `builder.py:138` — "FULL EXIT LOCKOUT: I CANNOT close positions or modify take profits during autonomous operation."
- `builder.py:141` — "This is by design — my manual closes were a random, unoptimizable loss factor."

In v2:
- There is no daemon LLM wake path (confirmed in phase 5 acceptance doc).
- There is no `execute_trade` tool (deleted in phase 5 M7).
- The only LLM surface is `user_chat/prompt.py` which has a completely different, compact, correctly-scoped system prompt (`SYSTEM_PROMPT` constant at `user_chat/prompt.py:12`).

**Impact:**
- Zero runtime impact — nothing calls it.
- High audit impact: a reader opening `prompts/builder.py` will build a false model of the current system (thinks it has daemon wakes, thinks LLM executes trades, thinks autonomous operation exists).
- The CLAUDE.md TOOL_STRATEGY instruction ("Add to system prompt in `src/hynous/intelligence/prompts/builder.py`") is literally false in v2 — the registered tools are consumed by user_chat which does not use builder.py. Following the CLAUDE.md instruction would edit a prompt that no one reads.

**Reproduction / How it fires:**
- Doesn't. Importing `hynous.intelligence.prompts` executes the module body (which is just the `build_system_prompt` import from `__init__.py`), but nothing calls the function.

**Proposed fix:**

Delete:
1. `src/hynous/intelligence/prompts/builder.py` — entire file.
2. `src/hynous/intelligence/prompts/__init__.py` — entire file.
3. `src/hynous/intelligence/prompts/README.md` — entire file.
4. Remove the `prompts/` directory.

Update `CLAUDE.md` "Adding a New Tool" section (line 70) to remove the step:
```
3. **Add to system prompt** in `src/hynous/intelligence/prompts/builder.py` TOOL_STRATEGY section ...
```
Replace with:
```
3. **Add to `user_chat/prompt.py`** if the tool should be user-chat-invocable. The journal analysis agent uses `src/hynous/analysis/prompts.py` with a different tool surface.
```

Update `ARCHITECTURE.md` table at line 84 to remove the `prompts/` row:
```
| `prompts/` | System prompts (user-chat-oriented in v2; identity + tool strategy) |
```
This row is misleading — there is no system prompt in `prompts/` that's used by anything.

**Verification after fix:**
- `grep -rn "from.*prompts.*builder\|from.*prompts import build_system_prompt\|intelligence\.prompts" src/ dashboard/` returns 0 matches.
- `pytest tests/` still passes at baseline.
- `mypy src/` count does not increase.

**Dependencies:** None. `build_system_prompt` is truly isolated. Confirmed via grep.

---

### H3 — `deploy/setup.sh` produces a broken deployment and references a deleted subsystem

- **Severity:** High
- **Category:** broken-code + stale-doc
- **Status:** **RESOLVED 2026-04-21 in commit `b10febb`.** `setup.sh` now `cp`s all three unit files and `systemctl enable`s them at boot; the Discord echo is gone; the "Next steps" block specifies `systemctl start hynous-data hynous-daemon hynous` (correct order). `deploy/README.md` updated: quick-start uses three-service start; manual hynous-data install block removed (setup.sh now handles it); "Managing Services" commands list hynous-daemon everywhere; Discord row dropped from the test-instance table. `grep -rn "[Dd]iscord" deploy/` returns 0 matches.

**Files affected:**
- `deploy/setup.sh` (lines 57, 77, 98)
- `deploy/README.md` (lines 57, 60-66, 131)

**Evidence:**

`deploy/setup.sh` installs exactly one of the three systemd services:

```
deploy/setup.sh:77:cp "$APP_DIR/deploy/hynous.service" /etc/systemd/system/
deploy/setup.sh:78:systemctl daemon-reload
deploy/setup.sh:79:systemctl enable hynous
```

All three service files exist in `deploy/`:
```
deploy/hynous.service         # UI + journal (Reflex + FastAPI)
deploy/hynous-data.service    # Data layer (:8100)
deploy/hynous-daemon.service  # Mechanical loop + Kronos shadow
```

CLAUDE.md (line 18) and ARCHITECTURE.md both state the system requires all three services to run. Running `setup.sh` on a fresh VPS as-written leaves `hynous-data` and `hynous-daemon` uninstalled — the journal works, but there's no data layer and no trading loop.

The setup script also still echoes Discord guidance at line 98:
```
deploy/setup.sh:98:echo "  Discord bot starts automatically."
```
Discord was deleted in phase 4 (confirmed via master plan `Phase 4 complete 2026-04-12`). The `src/hynous/discord/` directory no longer exists. There is no Discord bot to start. The message will confuse a new operator.

Line 57 in the script installs `discord.py` as a Python dependency alongside dashboard requirements:
```
deploy/setup.sh:56:    pip install -e .
deploy/setup.sh:57:    cd dashboard && pip install -r requirements.txt
```
— the `discord.py` install is actually not in `setup.sh` directly (that's stated in `deploy/README.md:57`), but `deploy/README.md:57` claims it is:
```
deploy/README.md:57:4. **Python venv** — creates `.venv`, installs the project (`pip install -e .`) + `discord.py` + dashboard requirements.
```
`discord.py` is not in `pyproject.toml` dependencies and not in `dashboard/requirements.txt` either, so the README claim is unverifiable but harmless. The script's `echo "Discord bot starts automatically"` is the real bug because it tells the operator to look for something that doesn't exist.

`deploy/README.md` has partial acknowledgment of the setup.sh gap at lines 60-66 — it tells the reader to `cp /opt/hynous/deploy/hynous-data.service /etc/systemd/system/` manually. But the README never mentions `hynous-daemon.service`. A fresh operator following README exactly still gets 2/3 services.

The test-instance table at `deploy/README.md:131`:
```
│ Discord     │ enabled              │ disabled                  │
```
claims production has Discord enabled. It does not.

**Impact:**
- **Production-critical.** A fresh deploy does not produce a functioning trading system. The operator will have dashboard + journal running on :3000/:8000 but zero market data and zero trading loop. They'll have to manually discover and install the other two services.
- Cognitive load: misleading Discord messaging compounds the problem — operator goes looking for a Discord bot that doesn't exist.

**Reproduction:**
```
# On a fresh Ubuntu 24.04 VPS:
git clone https://github.com/12DDFF/Hynous.git /opt/hynous
bash /opt/hynous/deploy/setup.sh
systemctl status hynous-data      # → Unit hynous-data.service could not be found
systemctl status hynous-daemon    # → Unit hynous-daemon.service could not be found
systemctl status hynous           # → Active (but sitting idle with no data and no loop)
```

**Proposed fix:**

Edit `deploy/setup.sh`:

1. Replace the current single-service install block (around line 76-79) with:
```bash
# Install systemd services — all three are required for a working v2 system.
echo "Installing systemd services..."
cp "$APP_DIR/deploy/hynous.service" /etc/systemd/system/
cp "$APP_DIR/deploy/hynous-data.service" /etc/systemd/system/
cp "$APP_DIR/deploy/hynous-daemon.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable hynous hynous-data hynous-daemon
```

2. Delete line 98 (`echo "  Discord bot starts automatically."`).

3. Update the "Next steps" echo block to mention all three services:
```bash
echo "  2. Start the services (in this order — hynous-data first):"
echo "     systemctl start hynous-data hynous-daemon hynous"
echo ""
echo "  3. Check status:"
echo "     systemctl status hynous-data hynous-daemon hynous"
```

Edit `deploy/README.md`:

1. Line 57: remove the `+ discord.py` phrase.
2. Lines 60-66: remove the manual hynous-data.service install block (now done by setup.sh).
3. Line 131: change the Discord row in the test-instance table to something accurate, or delete the row entirely.

**Verification after fix:**
- Run `bash deploy/setup.sh` on a fresh VPS, then `systemctl status hynous hynous-data hynous-daemon` — all three should be `loaded; enabled`.
- `grep -rn "discord\|Discord" deploy/` should return only the intentional test-instance mention (if kept) or 0 matches if removed.

**Dependencies:** None.

---

### H4 — `src/hynous/README.md` describes deleted subsystems (discord, nous, agent)

- **Severity:** High (audit-facing)
- **Category:** stale-doc
- **Status:** **RESOLVED 2026-04-21 in commit `93dc039`.** Rewrote `src/hynous/README.md` to list the 8 actual v2 subpackages (`core/data/intelligence/journal/analysis/mechanical_entry/user_chat/kronos_shadow`). Dependency graph rebuilt to reflect v2 wiring (daemon orchestrates journal+analysis+mechanical_entry+kronos_shadow+data; LLM only in analysis + user_chat). Entry-points table: no Discord bot; three systemd services mentioned.

**Files affected:**
- `src/hynous/README.md` (entire file, 68 lines)

**Evidence:**

File footer says `Last updated: 2026-03-01`. Content references modules that were deleted between then and phase 5 completion (2026-04-12):

```
src/hynous/README.md:11:├── discord/       # Discord bot — chat relay, daemon notifications, stats panel
src/hynous/README.md:14:├── nous/          # Python HTTP client for the Nous TypeScript memory server
```

Neither `src/hynous/discord/` nor `src/hynous/nous/` exist on the v2 branch:
```
$ ls src/hynous/discord src/hynous/nous
ls: src/hynous/discord: No such file or directory
ls: src/hynous/nous: No such file or directory
```

The dependency diagram at lines 22-43 shows `intelligence` → `nous` and `discord` → `intelligence` — arrows pointing at modules that don't exist.

Line 48: "**`nous`** is a thin HTTP client. It connects to the Nous TypeScript server on `:3100`." — the Nous server was deleted in phase 4.

Lines 53-57 entry-points table:
```
| `scripts/run_dashboard.py` | Reflex dashboard (`:3000`) + Discord bot (background thread) |
```
— Discord bot does not start from `run_dashboard.py` because there is no Discord bot.

**Impact:**
- Anyone opening `src/hynous/README.md` to orient themselves will build a false model.
- Especially damaging for AI-agent readers (Claude Code, Cursor, etc.) that follow README files as ground truth.

**Reproduction:** Open the file.

**Proposed fix:**

Rewrite the entire file. Target content:

```markdown
# hynous

> Main Python package for the Hynous v2 crypto trading system.

---

## Package Map

```
hynous/
├── core/              # Shared utilities (config, clock, costs, persistence, tracing, trading_settings)
├── data/              # Market data providers (Hyperliquid REST + WS, Coinglass, hynous-data client, Paper sim)
├── intelligence/      # Mechanical trading loop — daemon, scanner, regime, tools (user-chat surface)
├── journal/           # v2 trade journal (9-table SQLite + embeddings + FastAPI router + migration)
├── analysis/          # Post-trade LLM analysis pipeline (rules + synthesis + validation)
├── mechanical_entry/  # Pluggable entry trigger + deterministic param computation + executor
├── user_chat/         # Read-only LLM chat agent mounted at /api/v2/chat/*
├── kronos_shadow/     # Read-only Kronos foundation-model predictor writing to a side table
└── __init__.py        # v0.1.0
```

## Dependency Direction

```
                  ┌──────────────┐
                  │ mechanical_  │─uses─┐
                  │   entry      │       │
                  └──────────────┘       v
                                   ┌──────────┐
                  ┌──────────────┐ │ journal  │
                  │  analysis    │─┤          │
                  └──────────────┘ │          │
                                   ├──────────┤
                  ┌──────────────┐ │   data   │
                  │ intelligence │─┤          │
                  │   (daemon)   │ │          │
                  └──────────────┘ │   core   │
                                   └──────────┘
                  ┌──────────────┐
                  │ user_chat    │─uses── tools/search_trades, tools/get_trade_by_id
                  └──────────────┘
                  ┌──────────────┐
                  │ kronos_shadow│─uses── journal.store._write_lock, data.providers
                  └──────────────┘
```

- `core` has no internal dependencies on other hynous modules (except reading its own config).
- `intelligence.daemon` is the trading loop orchestrator: imports from `journal` (capture + store), `analysis` (trigger_analysis_async), `mechanical_entry` (entry trigger + executor), `kronos_shadow` (side predictor), and `data` (providers).
- LLM is out of the trade-execution path. The daemon does not wake an LLM. The only LLM surfaces are `analysis/` (post-trade, background thread) and `user_chat/` (HTTP request/response).

## Entry Points

| Script | Starts |
|--------|--------|
| `scripts/run_dashboard.py` | Reflex dashboard (`:3000`) + FastAPI routers (journal + user-chat) mounted in-process |
| `scripts/run_daemon.py` | Standalone trading daemon (mechanical loop + Kronos shadow tick) |

Data layer runs separately — see `data-layer/scripts/run.py` (:8100 FastAPI).

---

Last updated: YYYY-MM-DD (post-v2)
```

**Verification after fix:** Manual review. Confirm every module listed exists via `ls src/hynous/`.

**Dependencies:** None.

---

### H5 — `config/README.md` documents config sections that no longer exist

- **Severity:** High (audit-facing)
- **Category:** stale-doc
- **Status:** **RESOLVED 2026-04-21 in commit `2f306f1`.** Dropped the four phantom sections (`nous` / `orchestrator` / `memory` / `sections`). New README documents the actual top-level YAML sections + the full `v2:` sub-config tree (journal / analysis_agent / mechanical_entry / consolidation / user_chat / kronos_shadow). Notes the legacy DaemonConfig fields with no v2 consumer (M6 scope). `agent.model` is now correctly flagged as legacy — `v2.user_chat.model` takes precedence.

**Files affected:**
- `config/README.md` (entire file, 293 lines)

**Evidence:**

File footer says `Last updated: 2026-03-12`. Documents these sections that are absent from both `config/default.yaml` and `src/hynous/core/config.py`:

- `config/README.md:168-178` — `nous -> NousConfig` (Nous memory server settings)
- `config/README.md:180-194` — `orchestrator -> OrchestratorConfig` (retrieval orchestrator)
- `config/README.md:196-209` — `memory -> MemoryConfig` (tiered memory + compression)
- `config/README.md:210-220` — `sections -> SectionsConfig` (memory sections)

None of these config sections exist:
```
$ grep -E "nous:|orchestrator:|memory:|sections:" config/default.yaml
(no matches)
$ grep "NousConfig\|OrchestratorConfig\|MemoryConfig\|SectionsConfig" src/hynous/core/config.py
(no matches)
```

`config/README.md:127` references `capital_breakeven_enabled` which was deprecated in the breakeven-fix revision per `docs/revisions/breakeven-fix/README.md` (Capital-BE replaced by Dynamic Protective SL).

The file also points readers at `docs/archive/memory-search/` and `docs/archive/memory-sections/` as if those are live features — they're explicitly archived v1 subsystems.

**Impact:**
- New operators reading `config/README.md` will try to set nous/orchestrator/memory/sections fields in YAML and get nothing (they'd be silently ignored by `load_config`).
- AI agents reading this doc will reference dead concepts.

**Reproduction:** Open the file.

**Proposed fix:**

Rewrite to match the actual config sections. Target content:

```markdown
# Configuration

> All app configuration lives here.

---

## Files

| File | Purpose | Restart Required |
|------|---------|------------------|
| `default.yaml` | Main app config | Yes |
| `theme.yaml` | UI styling | Yes |

---

## Environment Variables

Sensitive values live in `.env` (never committed):

```bash
OPENROUTER_API_KEY=sk-or-...     # LLM providers via OpenRouter (analysis + user chat)
HYPERLIQUID_PRIVATE_KEY=...      # Exchange wallet (testnet/live only)
OPENAI_API_KEY=sk-...            # Journal + analysis embeddings (text-embedding-3-small)
COINGLASS_API_KEY=...            # Derivatives data (optional)
```

---

## Config Sections

Each YAML top-level section maps to a dataclass in `src/hynous/core/config.py`:

| YAML key | Dataclass | Purpose |
|----------|-----------|---------|
| `app` | (none) | Metadata — name, version |
| `execution` | `ExecutionConfig` | Trading mode (paper/testnet/live), paper balance, tracked symbols |
| `hyperliquid` | `HyperliquidConfig` | Exchange endpoint URLs, default leverage, slippage |
| `agent` | `AgentConfig` | (v1 legacy) — default LLM model + tokens. See note below. |
| `coinglass` | (none) | API plan tier only |
| `daemon` | `DaemonConfig` | Polling intervals, risk guardrails, trailing stop tuning, candle peak tracking |
| `scanner` | `ScannerConfig` | Anomaly-detection thresholds |
| `data_layer` | `DataLayerConfig` | hynous-data service URL + timeout |
| `events` | (none) | Legacy thresholds, mostly unused |
| `satellite` | `SatelliteConfig` | ML feature engine — db paths, snapshot interval, coins |
| `logging` | (none) | Log level + format |
| `l2_subscriber` | (data-layer config) | Enable WS L2 collection |
| `tick_collector` | (data-layer config) | Enable tick-level feature collection |
| `v2` | `V2Config` | v2 sub-configs — journal, analysis_agent, mechanical_entry, consolidation, user_chat, kronos_shadow |

### Notes on `agent` section

`AgentConfig` is a legacy v1 structure. In v2 the trading path has no LLM. The `agent.model` field is read by the user-chat agent as a fallback, but `v2.user_chat.model` takes precedence. See `src/hynous/user_chat/agent.py`.

### Legacy DaemonConfig fields with no v2 consumer

`DaemonConfig` contains several fields that were wired to v1 LLM-wake cycles now removed:
`curiosity_threshold`, `curiosity_check_interval`, `decay_interval`,
`conflict_check_interval`, `health_check_interval`, `embedding_backfill_interval`,
`consolidation_interval`, `max_wakes_per_hour`, `wake_cooldown_seconds`,
`playbook_cache_ttl`, `periodic_interval`.

These are still loaded (YAML → dataclass) but consumed only in startup log lines. Leave them at defaults.

---

## Config Loading

```python
from hynous.core import load_config
config = load_config()
print(config.execution.mode)
print(config.v2.journal.db_path)
```

---

Last updated: YYYY-MM-DD
```

**Verification after fix:** Every section name in the new README must exist in `config/default.yaml` OR `src/hynous/core/config.py`.

**Dependencies:** None.

---

### M1 — `intelligence/briefing.py` + `intelligence/context_snapshot.py` — computation with no live consumer

- **Severity:** Medium (wasted CPU + misleading code)
- **Category:** dead-code + integrity-risk
- **Status:** **OPEN.** Not yet executed — largest remaining cleanup (~1800 LOC across `briefing.py` + `context_snapshot.py` + caller cleanup in `daemon.py` + `tools/trading.py` + `regime.py`). The audit recommends full delete (Phase A + B + C in Proposed fix below) since user_chat is deliberately journal-only and no briefing resurface is planned. Engineer should do this in one commit; H2 already landed so no merge conflict risk.

**Files affected:**
- `src/hynous/intelligence/briefing.py` — 1448 lines. Referenced by daemon but consumed only by dead endpoint.
- `src/hynous/intelligence/context_snapshot.py` — 352 lines. Zero consumers.
- `src/hynous/intelligence/tools/trading.py` — 2 lines call `invalidate_briefing_cache()` which invalidates cache nothing reads.
- `src/hynous/intelligence/regime.py` — takes a `data_cache` parameter but marks it "Unused (kept for caller compat)".

**Evidence:**

`build_briefing()` has only one internal caller inside briefing.py itself:
```
src/hynous/intelligence/briefing.py:1250:        briefing = build_briefing(
```
That caller is `_build_and_store_full()`, which is only called by `get_briefing_injection()` at briefing.py:1234 and 1236.

`get_briefing_injection()` has **no external caller** anywhere in the codebase:
```
$ grep -rn "get_briefing_injection" src/ dashboard/
src/hynous/intelligence/briefing.py:15:     # <doc comment>
src/hynous/intelligence/briefing.py:1197:def get_briefing_injection() -> str | None:
```
Two self-references. Zero call sites.

However, `DataCache` — the expensive-to-compute data structure that feeds `build_briefing()` — IS still actively instantiated and polled by the daemon:
```
src/hynous/intelligence/daemon.py:220:        self._data_cache = DataCache()
src/hynous/intelligence/daemon.py:1268:            self._data_cache.poll(self._get_provider(), brief_targets)
src/hynous/intelligence/daemon.py:1292:                self.snapshot, self._data_cache, self._scanner,   # passed to regime.classify()
```

The `data_cache` parameter is passed to `RegimeClassifier.classify()` — but `regime.py` marks it:
```
src/hynous/intelligence/regime.py:365:                 candles_1h: list[dict] | None = None,
src/hynous/intelligence/regime.py:367:        """Compute current 2-axis regime from data sources + candle indicators.
src/hynous/intelligence/regime.py:369:            data_cache: Unused (kept for caller compat).
```

`invalidate_briefing_cache()` IS still called from trading.py close/modify paths:
```
src/hynous/intelligence/tools/trading.py:640:        from ..briefing import invalidate_briefing_cache
src/hynous/intelligence/tools/trading.py:641:        invalidate_briefing_cache()
src/hynous/intelligence/tools/trading.py:1028:        from ..briefing import invalidate_briefing_cache
src/hynous/intelligence/tools/trading.py:1029:        invalidate_briefing_cache()
```
But what it invalidates (`_last_state`) is only READ by `get_briefing_injection()` — which has no caller. So the invalidation runs but no one ever reads the thing being invalidated.

`build_snapshot()` in context_snapshot.py has zero callers:
```
$ grep -rn "build_snapshot\(" src/ dashboard/
src/hynous/intelligence/context_snapshot.py:29:def build_snapshot(provider, daemon, config) -> str:
```
One hit — the definition itself. No consumer.

`invalidate_snapshot()` in context_snapshot.py: zero callers in src/ or dashboard/.

**Impact:**
- `DataCache.poll()` runs every derivative poll cycle (~300s). It makes HTTP calls to fetch L2 orderbook, 7d candles, and 7d funding history for every "briefing target" symbol (positions + BTC). All of that HTTP traffic feeds data that's never read. Wasted API quota + wasted time.
- `regime.classify()` receives a `data_cache` arg it doesn't use. Minor — already documented in the function itself, but the caller site daemon.py:1292 still passes it.
- `invalidate_briefing_cache()` calls in trading.py are no-ops functionally — but they look intentional, adding noise.
- `context_snapshot.py` is entirely dead.
- 1800 lines of code in `briefing.py` + `context_snapshot.py` create the appearance of an active feature ("briefing injection for user chats" per docstring) that does not exist. The user_chat agent uses its own minimal prompt with no briefing injection.

**Reproduction / How it fires:**
- `daemon._poll_derivatives()` → `self._data_cache.poll(...)` every 300s → fetches L2 + 7d candles + 7d funding for each tracked coin → writes into `DataCache._data` → read only by `build_briefing()` which is never called.

**Proposed fix:**

Phase A — remove the dead consumers:
1. Delete `src/hynous/intelligence/context_snapshot.py` (entire file).
2. In `src/hynous/intelligence/briefing.py`, delete lines 1121-1406: the `_last_state`, `_last_full_briefing_time`, `_get_daemon()`, `_capture_state()`, `get_briefing_injection()`, `_build_and_store_full()`, `_build_delta()`, and `invalidate_briefing_cache()` functions. These are the dead-endpoint half.
3. In `src/hynous/intelligence/tools/trading.py`, delete the two `invalidate_briefing_cache()` call blocks (lines ~638-642 and ~1026-1030).

Phase B — decide on `DataCache` + `build_briefing` + `build_code_questions`:
- If no one will ever resurface "briefing" in the user-chat agent, delete the whole file.
- If there's an open intent to inject briefings into user_chat, leave `DataCache` + `build_briefing` + `_build_*` helpers but delete the daemon's poll call. Only poll if and when user_chat asks for a briefing.

Recommended: full delete. The user_chat agent is deliberately read-only journal-only per `user_chat/prompt.py`. Don't build new briefing infra.

Phase C — clean up callers:
1. In `src/hynous/intelligence/daemon.py`:
   - Delete line 219-220 `from .briefing import DataCache; self._data_cache = DataCache()`.
   - Delete line 1264-1270 `self._data_cache.poll(...)` call.
   - Delete line 1292 `self._data_cache` argument (pass None or drop the param).
2. In `src/hynous/intelligence/regime.py`:
   - Remove the `data_cache` parameter from `RegimeClassifier.classify()` signature and remove the "Unused (kept for caller compat)" docstring line. Update the daemon caller accordingly.

**Verification after fix:**
- `grep -rn "DataCache\|build_briefing\|get_briefing_injection\|invalidate_briefing_cache\|build_snapshot\|invalidate_snapshot\|context_snapshot" src/ dashboard/` returns 0 matches (or only in deleted files).
- `pytest tests/` passes at baseline.
- Daemon smoke test: `python -m scripts.run_daemon --duration 60` shows no errors.

**Dependencies:** H2 (builder.py dead code) is unrelated but often deleted in the same cleanup pass. Do H2 first if you want to avoid a merge conflict.

---

### M2 — `journal/staging_store.py` still present despite docstring claiming phase-4 deletion

- **Severity:** Medium (docstring lie)
- **Category:** stale-doc
- **Status:** **OPEN — BLOCKED on user decision.** The user was presented with the A-vs-B tradeoff in the cleanup session and has not yet picked. Option A (fix two lying docstrings, leave 315-line file + 2 test importers alone) is 5 minutes of work. Option B (rewrite `test_v2_capture.py` + `test_v2_journal_integration.py` to use JournalStore directly, then delete `staging_store.py`) is a 1-2 hour test refactor that risks baseline drift. Engineer rec: A. Do not touch code until user picks.

**Files affected:**
- `src/hynous/journal/staging_store.py` — 315 lines, still exists.
- `src/hynous/journal/__init__.py:8` — docstring claims deletion.
- `src/hynous/journal/README.md:26` — docstring claims deletion.

**Evidence:**

Docstring at `src/hynous/journal/__init__.py:8`:
```
Phase 4: staging_store.py is deleted alongside the rest of the v1 memory stack.
```

README at `src/hynous/journal/README.md:26`:
```
| `staging_store.py` | Phase-1 thin SQLite wrapper (deleted in phase 4) |
```

Reality — the file is present:
```
$ ls -la src/hynous/journal/staging_store.py
-rw-r--r--  1 bauthoi  staff  ...  src/hynous/journal/staging_store.py
```

And it has real consumers:
- `src/hynous/journal/migrate_staging.py` — imports `StagingStore` (kind of — it reads staging.db directly via sqlite3, so this is actually fine; grep hit was only in strings/comments).
- `tests/unit/test_v2_capture.py` — 6 uses of `StagingStore` in the fixture and roundtrip tests.
- `tests/integration/test_v2_journal_integration.py:386,557,562` — uses `StagingStore` directly to create a staging DB for migration tests.

So deletion isn't safe — it would break two test suites. The docstring lies about the deletion plan.

**Impact:**
- Anyone reading `journal/__init__.py` or `journal/README.md` will believe the file was deleted and is confused when they see it.
- Low-severity integrity: the master plan's phase-4 acceptance marked phase 4 complete without actually completing this cleanup item.

**Reproduction:** Read `src/hynous/journal/__init__.py`, then `ls src/hynous/journal/`.

**Proposed fix:**

Pick one of two paths:

**Option A (keep the file):** Update docstrings to match reality.
- `src/hynous/journal/__init__.py:5-8`: change the phase notes to read something like:
```
Phase 1: schema, staging_store, capture, counterfactuals (data capture pipeline).
Phase 2: JournalStore + embeddings + API routes + migration (production store).
Phase 3: LLM analysis agent writes into trade_analyses.

Note: staging_store.py remains in the tree because the integration tests and the
one-shot migration helper both import StagingStore. The daemon no longer writes
to it — JournalStore is the sole production write target.
```
- `src/hynous/journal/README.md:26`: change to:
```
| `staging_store.py` | Phase-1 thin SQLite wrapper (kept for tests + `migrate_staging.py`; daemon no longer writes) |
```

**Option B (actually delete the file):** Rewrite the two test files to use JournalStore directly. `migrate_staging.py` opens staging.db via raw `sqlite3.connect(..., uri=True)` (line 66), so it doesn't actually need StagingStore — confirm, then delete. Update tests:
- `tests/unit/test_v2_capture.py` — swap `StagingStore` fixture for `JournalStore` pointing at a tmp db.
- `tests/integration/test_v2_journal_integration.py` — same swap, plus the migration test needs to create a synthetic `trade_entry_snapshots_staging` table via raw SQL to exercise the migration code path.

Option A is lower risk and matches the spirit of phase 4 (which deleted the daemon write path but left the tests). Option B is a genuine code reduction.

**Verification after fix:**
- Option A: `grep -n "deleted in phase 4" src/hynous/journal/` returns 0 matches.
- Option B: `ls src/hynous/journal/staging_store.py` returns "No such file", and `pytest tests/` passes.

**Dependencies:** None.

---

### M3 — `tests/conftest.py` has three dead v1 placeholder fixtures

- **Severity:** Medium
- **Category:** dead-code
- **Status:** **RESOLVED 2026-04-21 in commit `4b229e7`.** The three TODO-stubbed fixtures (`mock_config`, `memory_store`, `mock_agent`) deleted; `tests/README.md` fixtures section rewritten to document the actual current fixtures (`tmp_journal_db`, `sample_entry_snapshot`, `sample_exit_snapshot`). Grep confirms zero usages.

**Files affected:**
- `tests/conftest.py` (lines 17-38)
- `tests/README.md:118-125` (documents the dead fixtures)

**Evidence:**

```
tests/conftest.py:20:def mock_config() -> None:
tests/conftest.py:21:    """Provide a mock configuration for tests."""
tests/conftest.py:22:    # TODO: Implement when Config class is created
tests/conftest.py:23:    return None

tests/conftest.py:27:def memory_store() -> None:
tests/conftest.py:28:    """Provide an in-memory Nous store for tests."""
tests/conftest.py:29:    # TODO: Implement when NousStore is created
tests/conftest.py:30:    # return NousStore(":memory:")
tests/conftest.py:31:    return None

tests/conftest.py:35:def mock_agent() -> None:
tests/conftest.py:36:    """Provide a mock agent for tests."""
tests/conftest.py:37:    # TODO: Implement when Agent is created
tests/conftest.py:38:    return None
```

The section header at line 13-16 says:
```
# v1 / pre-v2 placeholder fixtures (kept until phase 4 deletes the subsystems
# they reference).
```

Phase 4 completed 2026-04-12. The subsystems ARE deleted — `Config` class exists (so `mock_config` TODO is obsolete), `NousStore` is deleted permanently (so `memory_store` is obsolete), `Agent` class is deleted permanently (so `mock_agent` is obsolete).

No test in the current codebase uses these fixtures — they all return `None` anyway, so even if a test requested them, it would get `None`.

`tests/README.md:118-125` still documents these fixtures as if they're part of the public test API.

**Impact:**
- Misleading for anyone writing new tests — they'll see the fixtures and wonder if they should use them.
- Zero runtime impact.

**Reproduction:** Open `tests/conftest.py`.

**Proposed fix:**

Delete `tests/conftest.py` lines 13-38 (the "v1 / pre-v2 placeholder fixtures" section — header comment + three fixture definitions). Keep the v2 section starting at line 41.

Update `tests/README.md:118-125` — remove the fixtures documentation.

**Verification after fix:**
- `grep -n "mock_config\|memory_store\|mock_agent" tests/` returns 0 matches.
- `pytest tests/` passes at baseline (no test should have been using these).

**Dependencies:** None.

---

### M4 — `core/trading_settings.py` docstring references deleted Nous subsystem

- **Severity:** Low (one-line comment)
- **Category:** stale-doc
- **Status:** **RESOLVED 2026-04-21 in commit `b0fac9f` (user chose delete the field entirely).** `trade_history_warnings` field + its section header removed from `TradingSettings`. Grep of src/ + dashboard/ confirmed zero consumers. Persisted JSON-load path already has a `hasattr(ts, k)` guard so stale keys in operators' `storage/trading_settings.json` are silently skipped.

**Files affected:**
- `src/hynous/core/trading_settings.py:167`

**Evidence:**

```
src/hynous/core/trading_settings.py:167:    trade_history_warnings: bool = True       # Warn on near-certain loser patterns from Nous trade history
```

Nous was deleted in phase 4. There is no Nous trade history. The setting `trade_history_warnings` still exists as a field but has no current consumer (no code reads it — confirm via grep).

**Impact:**
- Docstring lies about what the field does.
- The field itself may also be dead — grep `trade_history_warnings` to confirm no consumer. If dead, delete the field too.

**Proposed fix:**

1. `grep -rn "trade_history_warnings" src/` to find consumers.
2. If zero consumers: delete the field from `TradingSettings` dataclass.
3. If consumers exist: update the comment to match actual behavior, e.g.:
```python
trade_history_warnings: bool = True  # (unused in v2 — reserved for future trade-journal warning hook)
```

**Verification after fix:** The field's docstring must match its actual behavior.

**Dependencies:** None.

---

### M5 — `TICK_FEATURE_NAMES` defined in two places — drift risk between training and live data

- **Severity:** Medium (integrity risk)
- **Category:** integrity-risk
- **Status:** **RESOLVED 2026-04-21 in commit `1a3cd82`.** `data-layer/src/hynous_data/engine/tick_collector.py` now imports `TICK_FEATURE_NAMES` + `TICK_SCHEMA_VERSION` from `satellite.tick_features`. Shared venv via root `pyproject.toml` `packages = ["src/hynous", "satellite"]` confirmed working at runtime. Satellite-side header comment updated to say "single source of truth — do not duplicate." Grep confirms exactly one `^TICK_FEATURE_NAMES\s*=` definition across the repo.

**Files affected:**
- `satellite/tick_features.py:32-68` — canonical definition
- `data-layer/src/hynous_data/engine/tick_collector.py:28-65` — copy, with "keep in sync" comment

**Evidence:**

```
satellite/tick_features.py:32:TICK_FEATURE_NAMES = [
...
data-layer/src/hynous_data/engine/tick_collector.py:28:TICK_FEATURE_NAMES = [
data-layer/src/hynous_data/engine/tick_collector.py:27:# Canonical list lives in satellite/tick_features.py; keep in sync.
```

The code comment acknowledges the duplication. Both lists have 26 features currently at `TICK_SCHEMA_VERSION = 2`. They appear to match today — but there is no automated check.

If someone adds a feature to `satellite/tick_features.py` and forgets the data-layer copy:
- Data layer writes v2-schema rows with 26 columns (its local list).
- Training code reads from `satellite.tick_features.TICK_FEATURE_NAMES` (27 items after the addition) and expects the 27th column.
- Column ordering mismatch → model trained on one thing, inference run on another. Silent misinterpretation of features.

**Impact:**
- Today: none (lists are aligned).
- Under future edits: catastrophic silent failure mode for the tick direction model.

**Reproduction:** Edit one list, forget the other. Retrain. Inference predictions will be garbage but no crash.

**Proposed fix:**

`data-layer/src/hynous_data/engine/tick_collector.py` should import from `satellite.tick_features`. Both packages live in the same repo and already share a Python environment (see `pyproject.toml`'s `packages = ["src/hynous", "satellite"]`). Check that data-layer's package path allows importing `satellite` — it does if `PYTHONPATH` includes the repo root, which `data-layer/scripts/run.py` sets up.

Change `data-layer/.../tick_collector.py:26-70`:
```python
# Feature names — order matters, must match training.
from satellite.tick_features import TICK_FEATURE_NAMES, TICK_SCHEMA_VERSION
TICK_FEATURE_COUNT = len(TICK_FEATURE_NAMES)
# Note: _V2_FEATURES list below can also be derived from a diff, but keeping
# it static is fine since ALTER TABLE migrations are append-only.
```

Verify data-layer service can still import after the change:
```bash
cd data-layer && PYTHONPATH=..:. python -c "from hynous_data.engine.tick_collector import TICK_FEATURE_NAMES; print(len(TICK_FEATURE_NAMES))"
```

**Verification after fix:**
- Grep returns exactly one TICK_FEATURE_NAMES definition:
```
$ grep -rn "^TICK_FEATURE_NAMES\s*=" satellite/ data-layer/
satellite/tick_features.py:32:TICK_FEATURE_NAMES = [
```
- Data-layer tests (`cd data-layer && pytest tests/`) still pass.

**Dependencies:** Verify `satellite` is importable from the data-layer runtime environment.

---

### M6 — Legacy `DaemonConfig` fields consumed only by log strings

- **Severity:** Low (noise, not harm)
- **Category:** dead-config
- **Status:** **RESOLVED 2026-04-21 in commit `1674f8c` (Option A — user's choice).** Startup log line trimmed to `(price, deriv, scanner)`; the 8 v1 interval params (curiosity / decay / conflict / health / backfill / periodic-review) no longer print, so operators stop thinking those cycles run. The 11 legacy DaemonConfig fields + 2 deprecated properties (`next_review_seconds`, `cooldown_remaining`) remain loaded from YAML — Option B (full dataclass + YAML + property delete) left for a dedicated config-cleanup pass. `config/README.md` (H5 rewrite) already flags them as "loaded but unconsumed by v2 code."

**Files affected:**
- `src/hynous/core/config.py:56-76` (field definitions)
- `src/hynous/core/config.py:311-331` (YAML loading)
- `src/hynous/intelligence/daemon.py:514-519` (log line uses them)
- `src/hynous/intelligence/daemon.py:790, 802` (two deprecated property methods)

**Evidence:**

The following `DaemonConfig` fields are loaded from YAML but consumed only in a single startup log line and two deprecated properties:

```python
# core/config.py fields:
periodic_interval:          int = 3600
curiosity_threshold:        int = 3
curiosity_check_interval:   int = 900
decay_interval:             int = 21600
conflict_check_interval:    int = 1800
health_check_interval:      int = 3600
embedding_backfill_interval:int = 43200
consolidation_interval:     int = 86400
max_wakes_per_hour:         int = 6
wake_cooldown_seconds:      int = 120
playbook_cache_ttl:         int = 1800
```

All referenced only in:

```
src/hynous/intelligence/daemon.py:510-520:  (single startup log line)
        logger.info("Daemon started (price=%ds, deriv=%ds, review=%ds, curiosity=%ds, "
                     "decay=%ds, conflicts=%ds, health=%ds, backfill=%ds, scanner=%s)",
                     self.config.daemon.price_poll_interval,
                     self.config.daemon.deriv_poll_interval,
                     self.config.daemon.periodic_interval,
                     ...
```

And two deprecated properties (documented as deprecated in the property docstrings themselves):
- `next_review_seconds` at line 786 — "Seconds until next periodic review (doubled on weekends)." Property is in daemon.py:786-795 but no consumer.
- `cooldown_remaining` at line 798 — "Seconds remaining in wake cooldown (0 = ready)." No consumer.

No daemon loop uses any of these intervals as a timer anymore. The v1 crons they controlled (curiosity queue, FSRS decay, Nous health check, embedding backfill, consolidation, periodic review, wake rate limit) are all deleted.

**Impact:**
- Cosmetic. YAML looks richer than it is. Operators might tune these thinking they matter.
- Log line on boot displays irrelevant values.

**Reproduction:** Start the daemon — first log line at INFO includes curiosity/decay/conflict/health/backfill intervals.

**Proposed fix:**

Option A (minimal, safe): Leave the fields, trim the log line.
- Edit `daemon.py:510-520` log call to drop the v1-only params:
```python
logger.info("Daemon started (price=%ds, deriv=%ds, scanner=%s)",
             self.config.daemon.price_poll_interval,
             self.config.daemon.deriv_poll_interval,
             scanner_status)
```
- Add a one-line note in `config/README.md` (post-rewrite per H5) that these DaemonConfig fields are legacy.

Option B (aggressive): Delete the fields from `DaemonConfig` + `load_config` code + `config/default.yaml`.
- Must confirm nothing reads them (the two deprecated properties above are the only grep hits; both have no consumer so they can also be deleted).
- Remove 11 field definitions, 11 YAML loader lines, 11 YAML keys, 2 properties, and the log line.
- Risk: if external tooling (scripts, monitoring, dashboards) reads these YAML keys, they'll break. Grep first.

Recommended: Option A now, Option B later if a proper v2 config cleanup pass happens.

**Verification after fix:**
- `grep -rn "decay_interval\|consolidation_interval\|curiosity" src/` returns only the expected remaining references.

**Dependencies:** None.

---

### M7 — Daemon monolith (4117 lines) violates "one feature = one module"

- **Severity:** Low
- **Category:** maintainability
- **Status:** **DEFERRED** (per audit's own guidance — multi-PR refactor effort, not cleanup). Post-H1 daemon.py is 3951 lines, not 4117.
- **Status:** Observed (not a bug)

**Files affected:**
- `src/hynous/intelligence/daemon.py` — 4117 lines

**Evidence:**

CLAUDE.md line 227 states:
```
- **One feature = one module.** Don't mix concerns.
```

`daemon.py` handles:
1. Main loop (`_loop`, `_loop_inner`)
2. Price polling (`_poll_prices`, `_update_ws_coins`)
3. Derivatives polling (`_poll_derivatives`)
4. Historical snapshot recording (`_record_historical_snapshots`)
5. Regime classification integration (`_fetch_regime_candles`, `_fetch_fast_signals`)
6. Satellite tick + inference (`_run_satellite_inference`, `_fetch_satellite_candles`)
7. Fast trigger check (`_fast_trigger_check`) — SL/TP fills
8. Dynamic protective SL layer (inside `_fast_trigger_check`)
9. Fee-breakeven layer (inside `_fast_trigger_check`)
10. Trailing stop v3 layer (inside `_fast_trigger_check`)
11. Small wins mode exits (inside `_fast_trigger_check` + `_check_profit_levels`)
12. Candle peak tracking (`_update_peaks_from_candles`)
13. Position change detection (`_check_positions`, `_handle_position_close`, `_classify_fill`, `_override_sl_classification`)
14. Profit level monitoring (`_check_profit_levels`, `_maybe_alert`, `_wake_for_profit`)
15. Daily PnL circuit breaker (`_check_daily_reset`, `_update_daily_pnl`, `_persist_daily_pnl`, `_load_daily_pnl`)
16. Mechanical entry trigger init + eval (`_init_mechanical_entry`, `_evaluate_entry_signals`, `_periodic_ml_signal_check`)
17. Kronos shadow predictor init + tick (`_init_kronos_shadow`, `_run_kronos_shadow_tick`)
18. Labeler thread (`_run_labeler`, `_labeler_candle_fetcher`)
19. Validation thread (`_run_validation`)
20. Feedback analysis thread (`_run_feedback_analysis`)
21. Counterfactual recompute thread (`_recompute_pending_counterfactuals`)
22. Position types registry (`register_position_type`, `get_position_type`, `_persist_position_types`, `_load_position_types`)
23. Mechanical state persistence (`_persist_mechanical_state`, `_load_mechanical_state`)
24. Stale staged-entries code (H1 — to be deleted)
25. Many read-only properties for dashboard (`status`, `is_running`, `satellite_enabled`, `trading_paused`, `daily_realized_pnl`, `wakes_this_hour`, `next_review_seconds`, etc.)

**Impact:**
- Not a bug. Refactor target.
- Every change to one concern requires reading the whole file to not break others.

**Proposed fix:**

Multi-PR refactor. Split daemon.py into a package:
```
src/hynous/intelligence/daemon/
├── __init__.py               # Public Daemon class + get_active_daemon
├── core.py                   # __init__, start, stop, main loop
├── polls.py                  # _poll_prices, _poll_derivatives, _record_historical_snapshots
├── fast_trigger.py           # _fast_trigger_check + the three SL layers + small wins
├── positions.py              # _check_positions, _handle_position_close, _classify_fill
├── profit.py                 # _check_profit_levels, _maybe_alert, _wake_for_profit
├── circuit_breaker.py        # _check_daily_reset, _update_daily_pnl, persistence
├── mechanical_entry.py       # _init_mechanical_entry, _evaluate_entry_signals, _periodic_ml_signal_check
├── kronos_shadow.py          # _init_kronos_shadow, _run_kronos_shadow_tick
├── satellite_integration.py  # satellite tick + inference + condition + tick direction
├── labeler.py                # _run_labeler + thread management
├── validation.py             # _run_validation
├── feedback.py               # _run_feedback_analysis
├── counterfactuals.py        # _recompute_pending_counterfactuals
├── persistence.py            # position types + mechanical state
└── status.py                 # status property + read-only properties for dashboard
```

This is a multi-week effort; do not attempt in a single PR.

**Verification after fix:** Baseline test suite still at 592p/0f. Daemon smoke test passes.

**Dependencies:** Do H1 first (delete staged_entries code) to avoid moving dead code into the refactor.

---

### M8 — `paper.py` `TAKER_FEE` constant diverges from `trading_settings.taker_fee_pct`

- **Severity:** Low
- **Category:** integrity-risk
- **Status:** **RESOLVED 2026-04-21 in commit `2eb7232`.** Hardcoded `TAKER_FEE = 0.00035` class constant replaced with `_taker_fee_per_side()` method that reads `get_trading_settings().taker_fee_pct / 2.0 / 100.0` at call time. All six `self.TAKER_FEE` references replaced. Math verified: default `taker_fee_pct=0.07` yields 0.00035 per side — identical to the prior constant. Runtime tuning now propagates without restart.

**Files affected:**
- `src/hynous/data/providers/paper.py:69` — `TAKER_FEE = 0.00035`
- `src/hynous/core/trading_settings.py:62-64` — `taker_fee_pct: float = 0.07` (round-trip %)

**Evidence:**

```
src/hynous/data/providers/paper.py:69:    TAKER_FEE = 0.00035  # 0.035% per side (Hyperliquid's actual rate)
src/hynous/core/trading_settings.py:62-64:
    taker_fee_pct: float = 0.07  # ROUND-TRIP fee as % of notional — covers BOTH entry AND exit
                                  # 0.07% total = ~0.035% per side (3.5bps/side)
```

PaperProvider uses `TAKER_FEE` as a per-side decimal (0.00035 = 0.035% per side). TradingSettings stores `taker_fee_pct` as a round-trip percent (0.07% = 0.035% per side). Values align numerically today.

**Impact:**
- If an operator tunes `taker_fee_pct` in `storage/trading_settings.json`, paper mode will continue to apply the hardcoded 0.00035 rate — paper PnL will drift from what the operator expects.
- Not currently a production concern because live mode doesn't use PaperProvider.

**Proposed fix:**

Make PaperProvider read `get_trading_settings().taker_fee_pct` on fee calculation, or drop the hardcoded constant and compute per-side from the round-trip value:

```python
from hynous.core.trading_settings import get_trading_settings

def _taker_fee_per_side(self) -> float:
    """Per-side fee as a decimal (e.g., 0.00035 for 0.07%/2)."""
    return get_trading_settings().taker_fee_pct / 2.0 / 100.0
```

Then replace every `self.TAKER_FEE` reference with `self._taker_fee_per_side()`.

**Verification after fix:**
- Paper mode fee math updates when trading_settings.taker_fee_pct is changed at runtime.
- Existing tests continue to pass (they use the default 0.07 which maps to 0.00035 per side).

**Dependencies:** None.

---

### M9 — `dashboard.py` is a 892-line monolith with business logic intermixed with the Reflex app factory

- **Severity:** Low
- **Category:** maintainability
- **Status:** **DEFERRED** (per audit's own guidance — multi-PR refactor effort, not cleanup).

**Files affected:**
- `dashboard/dashboard/dashboard.py` — 892 lines

**Evidence:**

The file contains the app factory, journal/chat router mounting, AND 11 Starlette proxy/API routes:
- `_data_proxy` — proxies `/api/data/*` → `:8100`
- `_agent_message` — retired 410 stub
- `_reset_paper_stats`
- `_data_health_proxy`
- `_candle_proxy`
- `_ml_status`, `_ml_features`, `_ml_snapshots_stats`, `_ml_predictions`, `_ml_predictions_history`, `_ml_model`, `_ml_satellite_toggle`, `_ml_conditions`

Each with its own `async def` and database/subprocess/HTTP logic inline.

**Impact:**
- Not a bug. Hard to navigate. Hard to test routes in isolation.

**Proposed fix:**

Extract to `dashboard/dashboard/api/` package:
```
dashboard/dashboard/api/
├── __init__.py        # register_routes(app) — single entry point
├── data_proxy.py      # _data_proxy, _data_health_proxy
├── candles.py         # _candle_proxy
├── paper.py           # _reset_paper_stats
└── ml.py              # All 8 _ml_* routes
```

Then `dashboard.py` shrinks to ~300 lines of app factory + router mounting.

**Verification after fix:** Dashboard loads, all routes respond (manual test).

**Dependencies:** None.

---

---

### C1 — Live v3 direction model produces 100% skip (production outage)

- **Severity:** Critical (live trading loop has produced zero entries since 2026-04-21 02:38:40 UTC)
- **Category:** broken-code + integrity-risk
- **Status:** **OPEN — BLOCKED on user actions.** Step 0 (VPS rollback) and Step 3 (run diagnose script on VPS, share JSON output) are user-gated per the "For the Next Engineer" preamble. H7 (step 2) is resolved — the diagnose script now runs cleanly. Once the user executes the rollback + diagnose + picks the fix branch (lower threshold vs retrain), engineer finishes via step 5 (H8) + step 6 (C1 fix + H6 script correction). Until then, trading remains halted on the VPS. Original verification: static code inspection + commit archaeology + artifact metadata comparison — every precondition for the reported 100% skip behaviour confirmed.

**Files affected:**
- `scripts/retrain_direction_v3_snapshots.py` (lines 80-81) — the retrain script used to produce the artifact
- `satellite/artifacts/v3/metadata_v3.json` — deployed artifact metadata
- `satellite/artifacts/v2/metadata_v2.json` — previous artifact for comparison
- `satellite/inference.py` (lines 195-225) — threshold-based skip logic
- `src/hynous/mechanical_entry/ml_signal_driven.py` (lines 150-158) — the gate that rejects with `no_direction_signal`
- `config/default.yaml:139` — `inference_entry_threshold: 3.0`
- Commit `771ef4a` — the retrain commit

**Evidence (what's on disk right now):**

The commit message on `771ef4a` claims:
```
Direction v3 replaces v2 with peak ROE target (best_roe_30m_net) instead
of risk_adj_30m. v2 was emitting 100% skip on recent data because
risk_adj labels are usually negative, making the 3% entry threshold
architecturally unreachable. v3 produces positive predictions with
72.7% directional accuracy (long) and 49% precision at the 3% threshold.
```

The retrain script committed alongside this message (`scripts/retrain_direction_v3_snapshots.py`) uses the EXACT target the commit message says it was replacing:
```python
scripts/retrain_direction_v3_snapshots.py:80:    long_data = prepare_training_data(rows, "risk_adj_long_30m", train_end_ts)
scripts/retrain_direction_v3_snapshots.py:81:    short_data = prepare_training_data(rows, "risk_adj_short_30m", train_end_ts)
```

`risk_adj_*` is peak ROE minus MAE (a usually-negative value — see `satellite/training/pipeline.py:61-64`):
```sql
(sl.best_long_roe_30m_net + sl.worst_long_mae_30m) AS risk_adj_long_30m,
(sl.best_short_roe_30m_net + sl.worst_short_mae_30m) AS risk_adj_short_30m
```

**Artifact metadata comparison (v2 vs v3):**

| Field | v2 | v3 | Notes |
|-------|----|----|-------|
| `training_samples` | 50132 | 61798 | v3 is genuinely new, trained on more data |
| `training_end` | 2026-02-08 | 2026-03-19 | v3 has fresher data |
| `validation_mae` | 5.332 | 1.510 | **Radically different** output scale |
| `feature_hash` | `917773f7d4e31d94` | `917773f7d4e31d94` | Same features |
| `target_column` | **not recorded** | **not recorded** | See H8 — audit gap |

The MAE difference (5.3 → 1.5) is a factor-of-3.5 shift. Consistent with the v2 artifact being trained on wider-distribution `risk_adj_*` (range roughly `[-20, +20]`) vs v3 trained on narrower-distribution `best_roe_30m_net` (peak ROE, clipped to `[-20, +20]` but empirically bounded near `[0, 15]` because MAE of the negative component is excluded).

**This yields two competing hypotheses — both explain the 100% skip but differ on what was deployed:**

**Hypothesis A: the deployed artifact was trained on `best_roe_30m_net` (matches commit message)**
- The retrain script in the repo is OUT OF DATE vs what was actually run. Someone modified the script locally, ran it, committed the artifact but not the script edit.
- v3 predictions cluster with MAE ~1.5% around their mean. If the mean is ~0-2%, the 3% threshold (from `config.satellite.inference_entry_threshold`) is rarely crossed → near-100% skip.
- This means the commit message is accurate about the artifact but the REPRODUCIBILITY is broken — re-running `retrain_direction_v3_snapshots.py` would produce the v2-like model the message claims to replace.
- **Fix:** lower threshold OR retrain with a target naturally above 3% on favourable snapshots.

**Hypothesis B: the deployed artifact was trained on `risk_adj_*` (matches script, not message)**
- The MAE difference is explained by the larger training set (50k→62k) and fresher data smoothing out historical volatility, not a different target. Plausible but weaker — a 3.5x MAE improvement from ~20% more data is large.
- v3 predictions have the same skip-100% pathology as v2, just with different numerics.
- Commit message is wrong about what v3 replaced.
- **Fix:** retrain with `best_roe_30m_net` target as the commit message intended.

The only way to distinguish these is to actually run inference on recent snapshots and look at the prediction distribution — which is what `scripts/diagnose_direction_inference.py` is for (but see H7 for its path bug).

**Why the skip gate rejects with `no_direction_signal`:**

`satellite/inference.py:195-225`:
```python
def _decide(self, pred_long: float, pred_short: float) -> str:
    long_above = pred_long > self._threshold   # self._threshold = 3.0
    short_above = pred_short > self._threshold
    if not long_above and not short_above:
        return "skip"
    ...
```

`src/hynous/mechanical_entry/ml_signal_driven.py:150-158`:
```python
direction_signal = preds.get("signal")  # "long" | "short" | "skip" | "conflict"
if direction_signal not in ("long", "short"):
    self._rejection_record(
        ctx, symbol=symbol, reason="no_direction_signal",
        detail={"signal": direction_signal},
    )
    return None
```

So any `skip` or `conflict` from inference is counted as `no_direction_signal` at the gate level. This matches the reported 1/min rejection cadence (60s mechanical entry check).

**The Kronos corroboration is also genuine:**

Per `src/hynous/kronos_shadow/shadow_predictor.py:70-77`, Kronos calls `long`/`short`/`skip` using thresholds `long_threshold=0.60` and `short_threshold=0.40`. Reported log line `kronos-shadow BTC: prob=0.103 → short (live=skip)` means Kronos emitted `short` (prob 0.103 ≤ 0.40) while live (v3 satellite) emitted `skip`. Kronos is an independent foundation model — when it emits directional verdicts while the live model doesn't, that's evidence the signal is not universally absent; v3 is the one refusing to emit.

**Journal rejection pre/post comparison:**

Local journal.db at `storage/v2/journal.db` (developer machine, NOT the VPS) currently shows:
```
rejected | no_composite_score | 94
rejected | no_ml_predictions  | 33
```
These are pre-v3 rejection reasons. The developer's local DB still has the pre-v3 gate distribution; the VPS rejection distribution (which was cleared at the user's report time) matches the `no_direction_signal` story.

**Impact:**
- **Trading has been halted since restart.** Every mechanical entry attempt (60s cadence) produces a rejection row. No entries have filled. No journal trade rows will exist beyond rejection type.
- Downstream analysis agent (post-trade) has nothing to analyse — it only wakes on exits.
- Kronos shadow predictions continue to accumulate (they don't gate on the skip → they write verdicts regardless), so shadow-vs-live comparison data is the only thing still being captured.

**Reproduction:**
- Start daemon with v3 loaded. `scripts/diagnose_direction_inference.py` (after H7 is fixed) will show the v3 prediction distribution to confirm which hypothesis applies.
- OR query `satellite.db` predictions table — every prediction written by the daemon has `signal` set:
```sql
SELECT signal, COUNT(*) FROM predictions
WHERE predicted_at >= strftime('%s','now','-1 hour')
GROUP BY signal;
```

**Proposed fix (in order):**

1. **IMMEDIATE — Stop the bleeding.** Roll the deployed model back to v2 on the VPS:
   - Daemon's `_init_satellite_inference` picks `versions[-1]` at `daemon.py:383`. Rename `satellite/artifacts/v3/` to `satellite/artifacts/v3.disabled/` on the VPS and restart the daemon — it will fall back to v2.
   - This is a temporary unblock. v2 was also known-broken per commit message, but at least its rejection reason was `composite_below_threshold` (downstream), suggesting it did produce some non-skip signals.
   - (Not actually recommended if v2 was truly 100% skip too — see point 5.)

2. **Run the diagnose script (after H7 path fix) to establish ground truth:**
   ```bash
   PYTHONPATH=src python scripts/diagnose_direction_inference.py \
     --v2 satellite/artifacts/v2 \
     --v3 satellite/artifacts/v3 \
     --days 7 --threshold 3.0
   ```
   The output will show signal distributions (long/short/skip/conflict %) for both v2 and v3 at multiple thresholds. This confirms which hypothesis is right.

3. **If Hypothesis A (artifact ≠ script):**
   - Identify the actually-run training script (check git reflog, shell history, or commit parent artifacts).
   - Decide: lower `inference_entry_threshold` to match v3 output scale (likely 1.0–1.5 based on MAE), OR retrain on a target that naturally exceeds 3% on favourable data.
   - Commit whatever script actually produced the artifact. The current script must match deployed artifacts — see C1's H6/H8 subordinates.

4. **If Hypothesis B (script matches artifact, both wrong):**
   - Fix the retrain script to use `best_long_roe_30m_net` / `best_short_roe_30m_net` targets (which do exist per `satellite/training/pipeline.py:57-67`):
     ```python
     long_data = prepare_training_data(rows, "best_long_roe_30m_net", train_end_ts)
     short_data = prepare_training_data(rows, "best_short_roe_30m_net", train_end_ts)
     ```
   - Re-run. Verify prediction distribution. Deploy.

5. **Longer-term — fix the threshold model:** The `inference_entry_threshold=3.0` value predates v3 and was chosen for risk-adjusted ROE targets. It shouldn't be hardcoded — it should be derived per-model from the training distribution. Alternative: have `InferenceEngine` compute a dynamic threshold during training (e.g., 75th percentile of positive training-set predictions) and store it in `ModelMetadata`.

**Verification after fix:**
- After ≥1 hour of live running: `SELECT signal, COUNT(*) FROM predictions WHERE predicted_at > (strftime('%s','now') - 3600) GROUP BY signal;` should show non-trivial `long` + `short` counts.
- Journal rejection distribution should show a mix (`composite_below_threshold`, `direction_confidence_below_threshold`, `entry_quality_below_threshold`, etc.), not 100% `no_direction_signal`.
- Kronos shadow `live_decision` column should stop being uniformly `skip` — grep logs for `live=long` / `live=short`.

**Dependencies:**
- H7 must be fixed before the diagnose script is runnable.
- H8 makes this class of bug recur — resolving it is a prerequisite for making future retrains auditable.

---

### H6 — `scripts/retrain_direction_v3_snapshots.py` contradicts the commit that shipped it

- **Severity:** High (makes the v3 training non-reproducible and the commit history unreliable)
- **Category:** broken-code + integrity-risk
- **Status:** **OPEN — BLOCKED on C1 step 3 output.** Fix branches on which hypothesis the diagnose script produces evidence for: Hypothesis A (`best_roe_30m_net` — correct the script) vs Hypothesis B (`risk_adj_*` — commit message was wrong, need a fresh retrain). Do not edit lines 80-81 until the user has raw diagnose output in hand and has chosen the C1 branch.

**Files affected:**
- `scripts/retrain_direction_v3_snapshots.py` (lines 80-81)
- Commit `771ef4a` (message vs diff mismatch)

**Evidence:**

Commit `771ef4a` message declares:
```
v3 replaces v2 with peak ROE target (best_roe_30m_net) instead of risk_adj_30m.
v2 was emitting 100% skip on recent data because risk_adj labels are usually
negative, making the 3% entry threshold architecturally unreachable.
```

The retrain script in the same commit passes the OLD target names to `prepare_training_data`:
```
scripts/retrain_direction_v3_snapshots.py:80:    long_data = prepare_training_data(rows, "risk_adj_long_30m", train_end_ts)
scripts/retrain_direction_v3_snapshots.py:81:    short_data = prepare_training_data(rows, "risk_adj_short_30m", train_end_ts)
```

These are the exact targets the commit message says the retrain was replacing. Either:
- (a) The committed script does not match what was actually run (irreproducibility), or
- (b) The commit message is wrong about what was replaced.

Either way, re-running `python scripts/retrain_direction_v3_snapshots.py` will not produce the deployed v3 artifact as advertised — it will produce a replica of the target the commit message says caused the 100% skip problem in v2.

**Impact:**
- Production reproducibility broken: nobody can re-run the committed script and get the same artifact that's deployed.
- Audit trail broken: commit message says one thing, code says another, artifacts record neither (see H8).
- Future retrains will inherit the broken target unless the script is corrected.

**Reproduction:**
```bash
# Fresh clone, run what the repo says is the v3 retrain:
python scripts/retrain_direction_v3_snapshots.py --db storage/satellite.db --output /tmp/retrain-test
# Open /tmp/retrain-test/v3/metadata_v3.json
# Compare against satellite/artifacts/v3/metadata_v3.json
# Expected to differ (notably validation_mae) because target is different
```

**Proposed fix:**

1. Determine which hypothesis is correct (see C1 proposed-fix step 2 — run the diagnose script).
2. If the deployed artifact was trained on `best_*_roe_30m_net` (Hypothesis A), correct the script:
   ```python
   # scripts/retrain_direction_v3_snapshots.py lines 80-81
   long_data = prepare_training_data(rows, "best_long_roe_30m_net", train_end_ts)
   short_data = prepare_training_data(rows, "best_short_roe_30m_net", train_end_ts)
   ```
   Commit the correction referencing commit `771ef4a` in the message: `"[v2-debug] H6: correct retrain script target names to match 771ef4a artifact"`.
3. If the deployed artifact was trained on `risk_adj_*` (Hypothesis B), the commit message is wrong. Revert the claim by amending via a follow-up commit with accurate notes, and decide whether to retrain properly.
4. Add a guard in `train_both_models` (or as a separate lint) that writes the `target_column` names into `ModelMetadata` (see H8) so future artifacts self-document what they predicted.

**Verification after fix:**
- `grep -n "target_column\|risk_adj_long_30m\|best_long_roe_30m_net" scripts/retrain_direction_v3_snapshots.py` matches the target that's actually intended.
- Re-running the script produces an artifact whose `validation_mae` and prediction distribution match the deployed artifact.

**Dependencies:** C1 (run the diagnose script to establish which hypothesis is correct). H7 (fix the diagnose script path before running it). H8 helps prevent recurrence but isn't blocking.

---

### H7 — `scripts/diagnose_direction_inference.py` default `--v3` path is wrong

- **Severity:** High (blocks root-cause analysis of C1 without an override flag)
- **Category:** broken-code
- **Status:** **RESOLVED 2026-04-21 in commit `7fe866f`.** Default changed from `"satellite/artifacts/v3/v3"` → `"satellite/artifacts/v3"` (one-line fix). Unblocks C1 step 3 — diagnose script can now be run on the VPS without an explicit `--v3` override.

**Files affected:**
- `scripts/diagnose_direction_inference.py` (line 101)

**Evidence:**

```
scripts/diagnose_direction_inference.py:100:    p.add_argument("--v2", default="satellite/artifacts/v2")
scripts/diagnose_direction_inference.py:101:    p.add_argument("--v3", default="satellite/artifacts/v3/v3")
```

But the actual v3 artifact location is a single directory level:
```
$ ls satellite/artifacts/v3/
metadata_v3.json  model_long_v3.pkl  model_short_v3.pkl  scaler_v3.json
```

`ModelArtifact.load(Path("satellite/artifacts/v3/v3"))` will fail — that path does not exist. The `--v2` default (`satellite/artifacts/v2`) IS correct, so the asymmetry is the giveaway.

**Impact:**
- Running `python scripts/diagnose_direction_inference.py` without an explicit `--v3 satellite/artifacts/v3` override raises `FileNotFoundError` on the first load attempt.
- This is exactly the tool an operator would grab to investigate C1. They will hit this error, not understand it, and waste time.

**Reproduction:**
```bash
python scripts/diagnose_direction_inference.py
# Expected: "FileNotFoundError: [Errno 2] No such file or directory: 'satellite/artifacts/v3/v3/metadata_v3.json'"
```

**Proposed fix:**

```python
# scripts/diagnose_direction_inference.py:101
p.add_argument("--v3", default="satellite/artifacts/v3")   # was: "satellite/artifacts/v3/v3"
```

Also verify `ModelArtifact.load` in `satellite/training/artifact.py:114` handles both relative and absolute paths; it extracts version from `version_dir.name.lstrip("v")`. A path of `satellite/artifacts/v3` yields `version_dir.name == "v3"` which parses correctly. Good.

**Verification after fix:**
```bash
python scripts/diagnose_direction_inference.py --days 1
# Expected: JSON output with v2 and v3 signal distributions, no exceptions
```

**Dependencies:** None. Single-line fix. Unblocks C1 investigation.

---

### H8 — `ModelMetadata` does not record the target column — retrained artifacts are un-auditable

- **Severity:** High (audit gap that enabled C1 to ship unnoticed)
- **Category:** integrity-risk
- **Status:** **OPEN — no blocker.** Engineer can ship anytime independent of C1 resolution. Add `long_target_column` + `short_target_column` to `ModelMetadata` (`satellite/training/artifact.py:27-56`); thread through `train_both_models` (`satellite/training/train.py:122-175`); update the two retrain scripts (`retrain_direction_v3_snapshots.py`, `retrain_direction_model.py`) to pass targets explicitly; backfill `metadata_v2.json` + `metadata_v3.json` by hand (write the currently-claimed target per the commit history, even if C1 ultimately proves that claim wrong — the metadata records what we *think* was trained). Load path warns (does not fail) on empty target_column so old artifacts still load. This is the closure step that makes future retrains auditable.

**Files affected:**
- `satellite/training/artifact.py` (lines 27-61) — `ModelMetadata` dataclass + (de)serialization
- `satellite/artifacts/v3/metadata_v3.json` — no `target_column` field
- `satellite/artifacts/v2/metadata_v2.json` — no `target_column` field
- `satellite/training/train.py` (lines 122-175) — `train_both_models` does not receive target name

**Evidence:**

`ModelMetadata` dataclass fields:
```
satellite/training/artifact.py:27-56:
    version: int
    feature_hash: str
    feature_names: list[str]
    created_at: str
    training_samples: int
    training_start: str
    training_end: str
    validation_mae: float
    validation_samples: int
    xgboost_params: dict
    notes: str = ""
```

No `target_column`, no `target_name`, no `target_description`. The only hint is free-text `notes`, which in v2 contains `"Long MAE: 5.331, Short MAE: 5.334"` and in v3 contains `"Long MAE: 1.568, Short MAE: 1.452"` — neither records which label was trained on.

`train_both_models(long_data, short_data, version, params)` at `satellite/training/train.py:122-175` receives `TrainingData` objects but does not know or record which `target_column` was passed to `prepare_training_data` — the target name is discarded at the `prepare_training_data` boundary.

Contrast with `ConditionArtifact` / `ConditionMetadata` in `satellite/training/condition_artifact.py:27-43`, which DOES record target info:
```python
class ConditionMetadata:
    name: str                      # e.g. "vol_1h"
    target_description: str        # human-readable target explanation
    ...
```

Direction models are the only production ML component whose target is not captured by the artifact. That's the audit gap that let C1 ship: nobody could tell from the artifact whether it was trained on `best_roe` or `risk_adj`.

**Impact:**
- Any future direction-model retrain with a changed target produces an artifact indistinguishable from prior ones. C1 is the first known instance — there will be more.
- Reproducibility: given only the repo + deployed artifact, there is no way to determine what was trained.

**Proposed fix:**

1. Add two fields to `ModelMetadata`:
   ```python
   # satellite/training/artifact.py
   @dataclass
   class ModelMetadata:
       # ... existing fields ...
       long_target_column: str = ""    # e.g. "best_long_roe_30m_net"
       short_target_column: str = ""   # e.g. "best_short_roe_30m_net"
   ```
2. Thread target names through `train_both_models`:
   ```python
   # satellite/training/train.py
   def train_both_models(long_data, short_data, version, params=None,
                         long_target_column: str = "",
                         short_target_column: str = ""):
       ...
       metadata = ModelMetadata(
           ...,
           long_target_column=long_target_column,
           short_target_column=short_target_column,
       )
   ```
3. Update callers (`retrain_direction_v3_snapshots.py`, `retrain_direction_model.py`) to pass the target names.
4. Add a validation check in `ModelArtifact.load` that warns (not fails — backward compat) when `long_target_column`/`short_target_column` are empty:
   ```python
   if not metadata.long_target_column or not metadata.short_target_column:
       log.warning(
           "Artifact v%d missing target_column fields — retrain to populate",
           metadata.version,
       )
   ```
5. After shipping the metadata fields, retrain v3 with the correct target (see C1/H6) and produce a v4 artifact that self-documents.

**Verification after fix:**
- New `metadata_v*.json` files contain non-empty `long_target_column` / `short_target_column` fields.
- Old artifacts still load (backward compat via `= ""` default).
- `ModelArtifact.load` logs a warning on v1/v2/v3 but not v4+.

**Dependencies:** None for the implementation. But doing H6 correctly requires H8 first if we want the corrected retrain to be verifiable.

---

## Fix Order (Topological) — Progress Snapshot

Recommended execution sequence. Groups are serial; items within a group can be one PR. **Cross-reference with "For the Next Engineer" at the top of this doc — some steps require human action, not engineer action.**

### Group 0 — Production triage (critical, blocks trading)
1. **[USER ACTION — ⏳ PENDING]** Rollback VPS to v2 direction artifact. Rename `satellite/artifacts/v3/` → `v3.disabled/` on the VPS and `systemctl restart hynous-daemon`. Daemon's `versions[-1]` picker at `daemon.py:383` will fall back to v2. Trading stays halted until this happens.
2. **H7 — ✅ DONE (`7fe866f`)** — `--v3` path default fixed.
3. **[ENGINEER+USER ACTION — ⏳ PENDING]** Run diagnose script on VPS, share raw JSON output with user. Do not interpret.
4. **[USER ACTION — ⏳ PENDING]** Pick C1 fix branch (lower threshold vs. retrain) from the diagnose output.
5. **H8 — ⏳ OPEN** — add `target_column` to `ModelMetadata` + backfill metadata files. Can ship anytime; doesn't block C1 step 6.
6. **C1 fix — ⏳ BLOCKED on step 4** — execute user-chosen branch.
7. **H6 — ⏳ BLOCKED on step 6** — recommit `retrain_direction_v3_snapshots.py` to match whatever target actually trained the production artifact.

### Group 1 — High-severity, no dependencies
- **H1 — ✅ DONE (`b468a80`)** — staged_entries dead code deleted from daemon.
- **H3 — ✅ DONE (`b10febb`)** — deploy setup + README for 3 services.
- **H4 — ✅ DONE (`93dc039`)** — src/hynous/README.md rewritten.
- **H5 — ✅ DONE (`2f306f1`)** — config/README.md rewritten.

### Group 2 — High-severity dead code (do after H1)
- **H2 — ✅ DONE (`ec03d27`, strict variant)** — prompts/ deleted + 4 stale prompt-introspection tests pruned.
- **M1 — ⏳ OPEN** — delete context_snapshot.py, delete dead half of briefing.py, clean up daemon + trading + regime caller sites. Largest remaining cleanup (~1800 LOC). H2 done so no merge-conflict risk.

### Group 3 — Medium-severity cleanup
- **M2 — ⏳ OPEN — BLOCKED on user A-vs-B decision** — reconcile staging_store.py docstring vs reality.
- **M3 — ✅ DONE (`4b229e7`)** — conftest.py v1 fixtures deleted + tests/README updated.
- **M4 — ✅ DONE (`b0fac9f`)** — `trade_history_warnings` field deleted (user chose delete, not rephrase).

### Group 4 — Integrity + low-severity polish
- **M5 — ✅ DONE (`1a3cd82`)** — TICK_FEATURE_NAMES deduped; data-layer imports from satellite.
- **M6 — ✅ DONE (`1674f8c`, Option A)** — startup log line trimmed to v2-relevant intervals.
- **M8 — ✅ DONE (`2eb7232`)** — paper.py reads fee from TradingSettings.

### Group 5 — Refactor (deferred, do not start as part of this debt-burn)
- **M7 — ⏳ DEFERRED** — daemon monolith split (multi-PR, separate effort).
- **M9 — ⏳ DEFERRED** — dashboard.py route extraction (separate effort).

### Score

- **✅ DONE:** 11 of 18 issues (H1, H2, H3, H4, H5, H7, M3, M4, M5, M6, M8)
- **⏳ OPEN (engineer can start anytime):** H8, M1
- **⏳ BLOCKED on user action or C1 diagnosis:** C1, H6, M2
- **⏳ DEFERRED out of audit scope:** M7, M9

---

## Out of Scope

Things I noticed but am NOT calling out here because they're working as intended or already-documented:

- `satellite/artifacts/tick_models.local-backup/` — untracked artifact directory. Amendment 4 in master plan explicitly says leave it.
- `v2.db` empty SQLite at repo root — harmless leftover, in .gitignore.
- Paper mode intentionally runs without kill switches (master plan policy).
- Phase 8 baselines (592p/0f) not re-verified — couldn't run tests during audit.

---

Last updated: 2026-04-21 (post-cleanup-session — 11 of 18 issues resolved on `v2`; Status Dashboard added; per-issue Status lines annotated with commit hashes or blocker; Fix Order scored. Remaining: C1/H6 gated on user VPS rollback + diagnose; H8 + M1 open for engineer; M2 gated on user A/B pick; M7/M9 deferred.)
