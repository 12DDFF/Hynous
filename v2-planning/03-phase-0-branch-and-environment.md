# Phase 0 — Branch & Environment Setup

> **Prerequisites:** `00-master-plan.md`, `01-pre-implementation-reading.md`, `02-testing-standards.md` all read in full.
>
> **Phase goal:** Create the v2 branch, establish the storage layout, capture static test baselines, add v2 config scaffolding. No functional code changes. This is infrastructure only.

---

## Context

Phase 0 is deliberately small. Its job is to create a clean starting environment for the subsequent phases. Nothing is deleted, nothing is refactored, nothing is built. Only these things happen:

1. A new `v2` git branch is created from `main`
2. A `v2-planning/` directory is already in place (this directory) — phase 0 confirms it
3. A baseline for static test errors is captured (mypy + ruff) so later phases can detect regressions
4. A `storage/v2/` directory is created as a parallel to `storage/` for v2-specific state files
5. `config/default.yaml` gets a new `v2:` section reserved for v2-only configuration
6. `src/hynous/core/config.py` gets a new `V2Config` dataclass
7. A project-wide README note about v2's branch model is added
8. A smoke test confirms the daemon still runs in its existing form

After phase 0, the codebase is identical in behavior to main, but the v2 scaffolding is in place for phase 1 to start modifying real code.

---

## Required Reading for This Phase

In addition to the base reading list from `01-pre-implementation-reading.md`, phase 0 engineers need to read:

1. **`config/default.yaml`** — full read. Understand the existing section structure.
2. **`src/hynous/core/config.py`** — full read. Understand how dataclasses are loaded from YAML.
3. **`CLAUDE.md`** — full read (already in base reading). Understand the deploy branch conventions that v2 is deviating from.
4. **`deploy/README.md`** if it exists, or inspect `deploy/` — understand the current systemd service model.
5. **`pyproject.toml`** — full read. Understand how the project is packaged, what dependencies exist, what dev tools are configured.

---

## Scope

### In Scope

- Creating and pushing the `v2` branch
- Adding `v2-planning/` directory to the branch (may already be there from the session that produced these docs)
- Capturing mypy and ruff baselines
- Creating `storage/v2/` directory structure
- Adding `v2` config section scaffolding
- Adding `V2Config` dataclass with initial fields (see implementation below)
- Creating an empty `src/hynous/journal/` directory with only an `__init__.py` (phase 2 fills it)
- Creating an empty `src/hynous/analysis/` directory with only an `__init__.py` (phase 3 fills it)
- Adding a brief v2 README pointer in the project root

### Out of Scope

- Any deletion of v1 code (phase 4)
- Any new trading logic (phases 1, 5)
- Any journal or analysis implementation (phases 2, 3)
- Any dashboard changes (phase 7)
- Any dependency additions to `pyproject.toml` (handled on a per-phase basis as needed)
- Setting up v2 deployment on the VPS (deferred until v2 is ready to deploy)

---

## Implementation

### Step 1: Create the v2 branch

Work from a clean `main` checkout:

```bash
cd /Users/bauthoi/Documents/Hynous
git checkout main
git pull origin main
git status  # must be clean

# Verify you're at the commit the plan was written against
git log --oneline -5

# Create v2 branch
git checkout -b v2
git status  # should report "on branch v2, nothing to commit"
```

**Do not push yet.** The first push happens after step 8 when phase 0 is complete.

### Step 2: Verify v2-planning directory exists

The `v2-planning/` directory should already exist with all the phase plan documents. Confirm:

```bash
ls -la v2-planning/
```

Expected output includes files:
- `00-master-plan.md`
- `01-pre-implementation-reading.md`
- `02-testing-standards.md`
- `03-phase-0-branch-and-environment.md` (this file)
- ... through `11-phase-8-quantitative.md`

If any are missing, **pause and report** — the planning session didn't complete.

### Step 3: Capture static test baselines

Create the baseline files that future phases compare against:

```bash
cd /Users/bauthoi/Documents/Hynous
source .venv/bin/activate

# mypy baseline
mypy src/hynous/ 2>&1 > v2-planning/mypy-baseline.txt || true
mypy src/hynous/ 2>&1 | grep -E "^Found [0-9]+ error" > v2-planning/mypy-baseline-count.txt || echo "Found 0 errors" > v2-planning/mypy-baseline-count.txt

# ruff baseline
ruff check src/hynous/ 2>&1 > v2-planning/ruff-baseline.txt || true
ruff check src/hynous/ --statistics 2>&1 > v2-planning/ruff-baseline-stats.txt || true

# Display what was captured
echo "--- mypy baseline ---"
cat v2-planning/mypy-baseline-count.txt
echo "--- ruff baseline ---"
cat v2-planning/ruff-baseline-stats.txt
```

These baseline files are committed to the v2 branch and serve as the reference for every future phase's static test check.

### Step 4: Create v2 storage directory

v2 keeps its state files in `storage/v2/` to avoid collision with v1 state files. This allows running the v2 branch alongside main on the same machine without corrupting v1 state.

```bash
mkdir -p storage/v2
touch storage/v2/.gitkeep
```

**Critical gotcha — directory exclusion vs file glob, AND pattern anchoring:**

`.gitignore` already has a blanket `storage/` exclusion line (around line 45). There are two distinct pitfalls in replacing it:

**Pitfall 1: directory exclusion blocks re-inclusion.** Git treats a trailing-slash pattern like `storage/` as a **directory exclusion**: once git matches it, git stops descending into the directory entirely. Per the gitignore docs:

> It is not possible to re-include a file if a parent directory of that file is excluded. Git doesn't list excluded directories for performance reasons, so any patterns on contained files have no effect, no matter where they are defined.

This means **no amount of later `!storage/v2/`, `!storage/v2/.gitkeep`, or similar re-inclusion rules can bring `.gitkeep` back** — git has already decided not to look inside `storage/`.

**Pitfall 2: pattern anchoring changes with slashes.** Per the gitignore docs:

> If the pattern contains a slash `/` (but not only a trailing slash at the very end), it is anchored to the location of the `.gitignore` file. Otherwise the pattern may also match at any level below the `.gitignore` level.

So `storage/` (only a trailing slash, no mid-path slash) is **unanchored** and matches a `storage/` directory at any depth in the tree — including `data-layer/storage/`, `nous-server/storage/`, etc.

A naive replacement like `storage/**` introduces a **middle slash** (between `storage` and `**`), which anchors the pattern to the repo root. That breaks coverage for nested `storage/` directories that were previously covered. Specifically, it leaves `data-layer/storage/hynous-data.pid` untracked, which then appears as a regression in `git status`.

The correct fix is **`**/storage/**`**: leading `**/` restores the "match at any depth" semantics (including depth zero, so root-level `storage/` is still covered), and trailing `/**` makes it a file glob rather than a directory exclusion so re-inclusion rules can still override on a per-file basis.

#### Part A: modify the existing `storage/` rule

Find the `# Data (don't commit databases)` block in `.gitignore` (around line 41–46). It currently looks like this:

```
# Data (don't commit databases)
data/*.db
data/*.sqlite
data/*.sqlite3
storage/
*.db
```

Change the `storage/` line to `**/storage/**`:

```
# Data (don't commit databases)
data/*.db
data/*.sqlite
data/*.sqlite3
**/storage/**
*.db
```

That's the only change to the parent rule. Do not touch the other lines in this block.

**Why `**/storage/**` and not `storage/**`:** the original `storage/` rule was unanchored and matched any `storage/` directory at any depth (there are four in this repo: `./storage/`, `./data-layer/storage/`, `./nous-server/storage/`, `./nous-server/server/storage/`). A root-anchored replacement like `storage/**` would leave nested ones (especially `data-layer/storage/hynous-data.pid`) as a regression. `**/storage/**` preserves the "any depth" semantics.

#### Part B: append the re-inclusion block at the end of the file

After all existing content, append this 3-line block:

```
# v2 state storage (runtime data)
# NOTE: parent rule above uses **/storage/** (file glob, not directory exclusion)
# so these negation rules can actually re-include .gitkeep. The order matters —
# !storage/v2/ first to re-include the directory, then storage/v2/* re-excludes
# contents, then !storage/v2/.gitkeep re-includes the placeholder file.
!storage/v2/
storage/v2/*
!storage/v2/.gitkeep
```

#### Verification

```bash
# Confirm the parent rule was changed
grep -n "^storage" .gitignore
# Expected output includes a line like `45:**/storage/**` — note the **

# Confirm .gitkeep is NOT ignored
git check-ignore -v storage/v2/.gitkeep
# Expected output: (empty) — the file is tracked

# Confirm other v2 state files ARE ignored (test with a throwaway path)
git check-ignore -v storage/v2/test.db
# Expected output: shows a rule hit (either `**/storage/**`, `storage/v2/*`, or `*.db`)

# Confirm v1 state files in storage/ root are still ignored
git check-ignore -v storage/nous.db
# Expected output: shows a rule hit

# Confirm nested v1 paths are still ignored
mkdir -p storage/payloads && touch storage/payloads/test.json
git check-ignore -v storage/payloads/test.json
# Expected output: shows `**/storage/**` hit
rm storage/payloads/test.json  # cleanup

# Confirm nested non-root storage/ dirs are still covered (regression check)
# This file exists in the repo if data-layer has been run:
git check-ignore -v data-layer/storage/hynous-data.pid 2>/dev/null || true
# Expected output (if file exists): shows `**/storage/**` hit
# If the file doesn't exist, run this instead to test the pattern:
git check-ignore -v data-layer/storage/test.pid
# Expected output: shows `**/storage/**` hit

# Finally, confirm git status shows .gitkeep as trackable
git status
# Expected: storage/v2/.gitkeep appears under "Untracked files"
```

If any of these verifications fail, **do not proceed**. Re-read the `.gitignore` changes and confirm both Part A (the `/**` suffix) and Part B (the 3-line block) are in place.

### Step 5: Add v2 config section to default.yaml

Open `config/default.yaml` and add a new top-level `v2:` section at the end of the file. This section holds v2-only configuration. Use this exact block:

```yaml
# ============================================================================
# v2 configuration
# These sections are only consumed by v2 branch code. They are ignored by
# v1 code. Do not remove or modify without approval from v2 plan.
# ============================================================================
v2:
  enabled: true  # Master switch for v2 features (must be true on v2 branch)
  
  # Journal module (phase 2)
  journal:
    db_path: "storage/v2/journal.db"
    embeddings_model: "openai/text-embedding-3-small"
    embeddings_dim: 1536
    comparison_dim: 512  # matryoshka truncation for fast similarity
    wal_mode: true
    busy_timeout_ms: 5000
  
  # Analysis agent (phase 3)
  analysis_agent:
    model: "anthropic/claude-sonnet-4.5"
    max_tokens: 4096
    temperature: 0.2
    retry_on_failure: false  # one-shot; manual re-analyze button available
    batch_rejection_interval_s: 3600  # hourly batch analysis of rejected signals
    timeout_s: 60
    prompt_version: "v1"  # bump when prompt changes
  
  # Mechanical entry (phase 5)
  mechanical_entry:
    trigger_source: "ml_signal_driven"  # or "hybrid_scanner_ml" when implemented
    composite_entry_threshold: 50       # minimum composite score to trigger entry
    direction_confidence_threshold: 0.55 # minimum direction model confidence
    require_entry_quality_pctl: 60       # minimum entry quality percentile
    max_vol_regime: "high"               # reject if vol is extreme
    roe_target_pct: 10.0                 # fixed TP target as ROE %
    coin: "BTC"                          # single coin for phase 1
  
  # Consolidation (phase 6)
  consolidation:
    edges_enabled: true
    edge_types: ["preceded_by", "followed_by", "same_regime_bucket", "same_rejection_reason", "rejection_vs_contemporaneous_trade"]
    pattern_rollup_enabled: true
    pattern_rollup_interval_hours: 168  # weekly
    pattern_rollup_window_days: 30
  
  # User chat (simplified journal query interface)
  user_chat:
    enabled: true
    model: "anthropic/claude-sonnet-4.5"
    max_tokens: 2048
    tool_surface: ["search_trades", "get_trade_by_id", "get_market_data"]
```

### Step 6: Add V2Config dataclass to core/config.py

Open `src/hynous/core/config.py`.

**Pre-check (verified 2026-04-09 against actual code):**
- `from dataclasses import dataclass, field` is already imported at **line 10**. No import changes needed.
- The root `Config` dataclass starts at **line 216**.
- The `load_config()` function starts at **line 241** and uses a `raw.get("<section>", {})` pattern followed by explicit keyword construction.

Add the dataclass definitions for v2 immediately BEFORE the `@dataclass` decorator of the root `Config` class (i.e. before line 215 in the current file — the exact line may shift if you've added anything above).

```python
# ============================================================================
# v2 configuration dataclasses
# ============================================================================

@dataclass
class V2JournalConfig:
    db_path: str = "storage/v2/journal.db"
    embeddings_model: str = "openai/text-embedding-3-small"
    embeddings_dim: int = 1536
    comparison_dim: int = 512
    wal_mode: bool = True
    busy_timeout_ms: int = 5000


@dataclass
class V2AnalysisAgentConfig:
    model: str = "anthropic/claude-sonnet-4.5"
    max_tokens: int = 4096
    temperature: float = 0.2
    retry_on_failure: bool = False
    batch_rejection_interval_s: int = 3600
    timeout_s: int = 60
    prompt_version: str = "v1"


@dataclass
class V2MechanicalEntryConfig:
    trigger_source: str = "ml_signal_driven"
    composite_entry_threshold: int = 50
    direction_confidence_threshold: float = 0.55
    require_entry_quality_pctl: int = 60
    max_vol_regime: str = "high"
    roe_target_pct: float = 10.0
    coin: str = "BTC"


@dataclass
class V2ConsolidationConfig:
    edges_enabled: bool = True
    edge_types: list[str] = field(default_factory=lambda: [
        "preceded_by", "followed_by", "same_regime_bucket",
        "same_rejection_reason", "rejection_vs_contemporaneous_trade",
    ])
    pattern_rollup_enabled: bool = True
    pattern_rollup_interval_hours: int = 168
    pattern_rollup_window_days: int = 30


@dataclass
class V2UserChatConfig:
    enabled: bool = True
    model: str = "anthropic/claude-sonnet-4.5"
    max_tokens: int = 2048
    tool_surface: list[str] = field(default_factory=lambda: [
        "search_trades", "get_trade_by_id", "get_market_data",
    ])


@dataclass
class V2Config:
    enabled: bool = True
    journal: V2JournalConfig = field(default_factory=V2JournalConfig)
    analysis_agent: V2AnalysisAgentConfig = field(default_factory=V2AnalysisAgentConfig)
    mechanical_entry: V2MechanicalEntryConfig = field(default_factory=V2MechanicalEntryConfig)
    consolidation: V2ConsolidationConfig = field(default_factory=V2ConsolidationConfig)
    user_chat: V2UserChatConfig = field(default_factory=V2UserChatConfig)
```

Then add the `v2` field to the root `Config` dataclass. Find the sub-configs block inside `class Config` (currently around lines 224-235) and add **after the last sub-config line** (currently `satellite: SatelliteConfig = field(default_factory=SatelliteConfig)` on line 235):

```python
    v2: V2Config = field(default_factory=V2Config)
```

Then update `load_config()` to parse the `v2:` YAML section into `V2Config`. Find the "Build config" block (starts around line 262) and add a new line alongside the other `<section>_raw = raw.get(...)` lines:

```python
    v2_raw = raw.get("v2", {}) or {}
```

Then inside the `return Config(...)` call (starts around line 276), add the `v2=` keyword argument **after the existing `satellite=SatelliteConfig(...)` call**. Use the `_from_dict`-style pattern that parses nested YAML into the nested dataclasses:

```python
        v2=V2Config(
            enabled=v2_raw.get("enabled", True),
            journal=V2JournalConfig(
                db_path=v2_raw.get("journal", {}).get("db_path", "storage/v2/journal.db"),
                embeddings_model=v2_raw.get("journal", {}).get("embeddings_model", "openai/text-embedding-3-small"),
                embeddings_dim=v2_raw.get("journal", {}).get("embeddings_dim", 1536),
                comparison_dim=v2_raw.get("journal", {}).get("comparison_dim", 512),
                wal_mode=v2_raw.get("journal", {}).get("wal_mode", True),
                busy_timeout_ms=v2_raw.get("journal", {}).get("busy_timeout_ms", 5000),
            ),
            analysis_agent=V2AnalysisAgentConfig(
                model=v2_raw.get("analysis_agent", {}).get("model", "anthropic/claude-sonnet-4.5"),
                max_tokens=v2_raw.get("analysis_agent", {}).get("max_tokens", 4096),
                temperature=v2_raw.get("analysis_agent", {}).get("temperature", 0.2),
                retry_on_failure=v2_raw.get("analysis_agent", {}).get("retry_on_failure", False),
                batch_rejection_interval_s=v2_raw.get("analysis_agent", {}).get("batch_rejection_interval_s", 3600),
                timeout_s=v2_raw.get("analysis_agent", {}).get("timeout_s", 60),
                prompt_version=v2_raw.get("analysis_agent", {}).get("prompt_version", "v1"),
            ),
            mechanical_entry=V2MechanicalEntryConfig(
                trigger_source=v2_raw.get("mechanical_entry", {}).get("trigger_source", "ml_signal_driven"),
                composite_entry_threshold=v2_raw.get("mechanical_entry", {}).get("composite_entry_threshold", 50),
                direction_confidence_threshold=v2_raw.get("mechanical_entry", {}).get("direction_confidence_threshold", 0.55),
                require_entry_quality_pctl=v2_raw.get("mechanical_entry", {}).get("require_entry_quality_pctl", 60),
                max_vol_regime=v2_raw.get("mechanical_entry", {}).get("max_vol_regime", "high"),
                roe_target_pct=v2_raw.get("mechanical_entry", {}).get("roe_target_pct", 10.0),
                coin=v2_raw.get("mechanical_entry", {}).get("coin", "BTC"),
            ),
            consolidation=V2ConsolidationConfig(
                edges_enabled=v2_raw.get("consolidation", {}).get("edges_enabled", True),
                edge_types=v2_raw.get("consolidation", {}).get("edge_types", [
                    "preceded_by", "followed_by", "same_regime_bucket",
                    "same_rejection_reason", "rejection_vs_contemporaneous_trade",
                ]),
                pattern_rollup_enabled=v2_raw.get("consolidation", {}).get("pattern_rollup_enabled", True),
                pattern_rollup_interval_hours=v2_raw.get("consolidation", {}).get("pattern_rollup_interval_hours", 168),
                pattern_rollup_window_days=v2_raw.get("consolidation", {}).get("pattern_rollup_window_days", 30),
            ),
            user_chat=V2UserChatConfig(
                enabled=v2_raw.get("user_chat", {}).get("enabled", True),
                model=v2_raw.get("user_chat", {}).get("model", "anthropic/claude-sonnet-4.5"),
                max_tokens=v2_raw.get("user_chat", {}).get("max_tokens", 2048),
                tool_surface=v2_raw.get("user_chat", {}).get("tool_surface", [
                    "search_trades", "get_trade_by_id", "get_market_data",
                ]),
            ),
        ),
```

Note: the nested `.get("<subsection>", {}).get(...)` pattern handles the case where the YAML has `v2:` present but a subsection missing — returns defaults cleanly without KeyError.

### Step 7: Create empty v2 module directories

```bash
mkdir -p src/hynous/journal
cat > src/hynous/journal/__init__.py <<'EOF'
"""Hynous v2 journal module.

SQLite-backed trade journal replacing Nous. Populated by phase 2.
"""
EOF

mkdir -p src/hynous/analysis
cat > src/hynous/analysis/__init__.py <<'EOF'
"""Hynous v2 analysis module.

Hybrid deterministic + LLM trade analysis pipeline. Populated by phase 3.
"""
EOF
```

These are empty scaffolds. Phase 2 and phase 3 populate them.

### Step 8: Add v2 branch note to project root

Create or update `README.md` in the project root to add a v2 note at the top:

If `README.md` exists, prepend (don't replace) the following block:

```markdown
> ⚠️ **v2 branch notice:** This is the `v2` branch of Hynous, a ground-up refactor.
> v2 will never be merged into `main`. For v1 architecture and usage, see `main`.
> For the v2 rebuild plan, see `v2-planning/00-master-plan.md`.
```

If `README.md` does not exist, create it with at least the v2 notice plus a link back to `ARCHITECTURE.md`.

### Step 9: Verify the environment still works

Run the baseline sanity checks:

```bash
cd /Users/bauthoi/Documents/Hynous
source .venv/bin/activate

# Import the V2Config
python -c "
from hynous.core.config import Config, V2Config, load_config
cfg = load_config()
print('config loaded ok')
print(f'v2 enabled: {cfg.v2.enabled}')
print(f'v2 journal db path: {cfg.v2.journal.db_path}')
print(f'v2 analysis model: {cfg.v2.analysis_agent.model}')
print(f'v2 mechanical entry coin: {cfg.v2.mechanical_entry.coin}')
"
```

Expected output:
```
config loaded ok
v2 enabled: True
v2 journal db path: storage/v2/journal.db
v2 analysis model: anthropic/claude-sonnet-4.5
v2 mechanical entry coin: BTC
```

If the import fails or the config values don't match, **pause and report**.

### Step 10: Commit phase 0

On main, the `v2-planning/` directory was untracked. When you created the v2 branch in step 1, those files carried over as untracked (git preserves untracked files across branch switches). Phase 0 is the commit where they become tracked, so they must be staged alongside the other phase 0 changes.

**Other untracked files that existed on main** (check with `git status`) may include:
- `docs/revisions/mc-fixes/implementation-guide.md`
- `docs/revisions/tick-system-audit/future-entry-timing.md`
- `satellite/artifacts/tick_models/`

**Do NOT stage those in the phase 0 commit.** They are prior v1 work that happens to be uncommitted on main and should be handled separately (either committed to main as a cleanup or left alone). Phase 0's commit is only about v2 scaffolding.

```bash
# Verify git state before staging — confirm what's about to be added
git status

# Stage v2-planning docs (all 12 .md files)
git add v2-planning/00-master-plan.md \
        v2-planning/01-pre-implementation-reading.md \
        v2-planning/02-testing-standards.md \
        v2-planning/03-phase-0-branch-and-environment.md \
        v2-planning/04-phase-1-data-capture.md \
        v2-planning/05-phase-2-journal-module.md \
        v2-planning/06-phase-3-analysis-agent.md \
        v2-planning/07-phase-4-tier1-deletions.md \
        v2-planning/08-phase-5-mechanical-entry.md \
        v2-planning/09-phase-6-consolidation-and-patterns.md \
        v2-planning/10-phase-7-dashboard-rework.md \
        v2-planning/11-phase-8-quantitative.md

# Stage the baseline files created in step 3
git add v2-planning/mypy-baseline.txt v2-planning/mypy-baseline-count.txt
git add v2-planning/ruff-baseline.txt v2-planning/ruff-baseline-stats.txt

# Stage the storage scaffolding
git add storage/v2/.gitkeep

# Stage the gitignore modification (fixed per step 4 — unignore parent + re-ignore + re-include kept file)
git add .gitignore

# Stage config changes
git add config/default.yaml
git add src/hynous/core/config.py

# Stage the new (empty) module scaffolds
git add src/hynous/journal/__init__.py
git add src/hynous/analysis/__init__.py

# Stage README changes
git add README.md

# Verify the staged set matches expectation before committing
git status

git commit -m "[phase-0] initialize v2 branch: planning docs, config scaffolding, storage layout, baselines"

git log --oneline -1  # confirm the commit lands
```

Expected `git status` output immediately before the commit:
- Under "Changes to be committed":
  - 12 × `v2-planning/*.md` (new file)
  - 4 × `v2-planning/*baseline*` (new file)
  - `storage/v2/.gitkeep` (new file)
  - `.gitignore` (modified)
  - `config/default.yaml` (modified)
  - `src/hynous/core/config.py` (modified)
  - `src/hynous/journal/__init__.py` (new file)
  - `src/hynous/analysis/__init__.py` (new file)
  - `README.md` (modified or new file)
- Under "Untracked files" (left alone, not in the commit):
  - `docs/revisions/mc-fixes/implementation-guide.md` (if present)
  - `docs/revisions/tick-system-audit/future-entry-timing.md` (if present)
  - `satellite/artifacts/tick_models/` (if present)

If the staged set does not match, pause and report before running `git commit`.

### Step 11: Push the branch

```bash
git push -u origin v2
```

This establishes the v2 branch on the remote and sets the upstream. Subsequent pushes from v2 go to `origin/v2`, not `origin/main`.

---

## Testing

### Static tests

**mypy:**

```bash
mypy src/hynous/ 2>&1 | tail -1
```

Compare to the baseline in `v2-planning/mypy-baseline-count.txt`. Must be **equal or lower**. Phase 0 should produce zero new errors because the only code change is adding dataclass definitions.

**ruff:**

```bash
ruff check src/hynous/ --statistics
```

Compare to the baseline in `v2-planning/ruff-baseline-stats.txt`. Must be **equal or lower**.

**Import sanity:**

```bash
python -c "from hynous.core.config import V2Config; print('ok')"
python -c "from hynous import journal; print('ok')"
python -c "from hynous import analysis; print('ok')"
```

All three must print `ok`.

### Dynamic tests

**Config loading test (new unit test):**

Create `tests/unit/test_v2_config.py`:

```python
"""Tests for v2 configuration scaffolding (phase 0)."""

import pytest
from hynous.core.config import (
    Config,
    V2Config,
    V2JournalConfig,
    V2AnalysisAgentConfig,
    V2MechanicalEntryConfig,
    V2ConsolidationConfig,
    V2UserChatConfig,
    load_config,
)


def test_v2_config_has_default_values():
    """V2Config instantiates with safe defaults."""
    cfg = V2Config()
    assert cfg.enabled is True
    assert cfg.journal.db_path == "storage/v2/journal.db"
    assert cfg.analysis_agent.model.startswith("anthropic/")
    assert cfg.mechanical_entry.coin == "BTC"


def test_load_config_populates_v2_section():
    """load_config returns a Config with a fully-populated V2Config."""
    cfg = load_config()
    assert isinstance(cfg.v2, V2Config)
    assert cfg.v2.enabled is True
    assert isinstance(cfg.v2.journal, V2JournalConfig)
    assert isinstance(cfg.v2.analysis_agent, V2AnalysisAgentConfig)
    assert isinstance(cfg.v2.mechanical_entry, V2MechanicalEntryConfig)
    assert isinstance(cfg.v2.consolidation, V2ConsolidationConfig)
    assert isinstance(cfg.v2.user_chat, V2UserChatConfig)


def test_v2_journal_db_path_is_under_v2_storage():
    """Journal DB must land in storage/v2/ not storage/ to avoid v1 collision."""
    cfg = load_config()
    assert cfg.v2.journal.db_path.startswith("storage/v2/")


def test_v2_mechanical_entry_coin_is_btc():
    """Phase 1 is BTC-only."""
    cfg = load_config()
    assert cfg.v2.mechanical_entry.coin == "BTC"


def test_v2_mechanical_entry_max_vol_regime_valid():
    """max_vol_regime must be one of the known regime labels."""
    cfg = load_config()
    assert cfg.v2.mechanical_entry.max_vol_regime in {"low", "normal", "high", "extreme"}


def test_v2_analysis_agent_config_has_retry_disabled():
    """Per plan: one-shot analysis with manual re-run, no auto-retry."""
    cfg = load_config()
    assert cfg.v2.analysis_agent.retry_on_failure is False


def test_v2_consolidation_edges_match_plan():
    """The conservative starter edge set per phase 6."""
    cfg = load_config()
    expected = {
        "preceded_by", "followed_by", "same_regime_bucket",
        "same_rejection_reason", "rejection_vs_contemporaneous_trade",
    }
    assert set(cfg.v2.consolidation.edge_types) == expected


def test_v1_config_still_loads():
    """v2 scaffolding must not break v1 config loading."""
    cfg = load_config()
    # Sanity: v1 fields that existed before phase 0 still work
    assert cfg.agent is not None
    assert cfg.daemon is not None
    assert cfg.satellite is not None
```

Run:

```bash
pytest tests/unit/test_v2_config.py -v
```

All 8 tests must pass.

**Regression:**

```bash
pytest tests/ -v
```

Full test suite must pass with no new failures.

**Smoke test:**

```bash
timeout 300 python -m scripts.run_daemon 2>&1 | tee storage/v2/smoke-phase-0.log
```

Inspect `storage/v2/smoke-phase-0.log` for:
- No ERROR lines
- Daemon startup completion log line
- At least one trigger check cycle

Expected: daemon behaves exactly as on main because phase 0 only adds config scaffolding that isn't consumed by any runtime code yet.

---

## Acceptance Criteria

- [ ] `v2` branch exists locally and on `origin/v2`
- [ ] `v2-planning/` directory contains all 12 plan documents (verify: `ls v2-planning/*.md | wc -l` returns `12`)
- [ ] All 12 `v2-planning/*.md` files are tracked on the v2 branch (verify: `git ls-files v2-planning/*.md | wc -l` returns `12`)
- [ ] `v2-planning/mypy-baseline-count.txt` exists and is committed
- [ ] `v2-planning/ruff-baseline-stats.txt` exists and is committed
- [ ] `storage/v2/` directory exists with a tracked `.gitkeep` file (verify: `git ls-files storage/v2/.gitkeep` returns the path)
- [ ] `git check-ignore -v storage/v2/.gitkeep` returns empty (i.e. the file is NOT ignored — the .gitignore fix worked)
- [ ] `git check-ignore -v storage/v2/some-other-file.db` is hit by a storage rule (i.e. other v2 state files ARE still ignored)
- [ ] `git check-ignore -v data-layer/storage/test.pid` is hit by `**/storage/**` (i.e. nested storage/ directories are still covered — no regression vs original `storage/` rule)
- [ ] `git check-ignore -v storage/nous.db` is hit by a storage rule (i.e. root-level v1 state files are still ignored)
- [ ] `config/default.yaml` has a `v2:` section with the exact fields specified above
- [ ] `src/hynous/core/config.py` has `V2Config` and all sub-dataclasses, loaded by `load_config()`
- [ ] `src/hynous/journal/__init__.py` exists (empty scaffold)
- [ ] `src/hynous/analysis/__init__.py` exists (empty scaffold)
- [ ] `README.md` has the v2 branch notice at the top
- [ ] `tests/unit/test_v2_config.py` has the 8 tests listed above and all pass
- [ ] `mypy src/hynous/` error count is equal or lower than baseline
- [ ] `ruff check src/hynous/` error count is equal or lower than baseline
- [ ] `pytest tests/` runs with zero new failures compared to main
- [ ] Smoke test runs for 5 minutes with no ERROR-level log lines
- [ ] Phase 0 is committed as a single commit on the v2 branch tagged `[phase-0]`

---

## Rollback

Phase 0 is trivial to roll back. If anything goes wrong:

```bash
git checkout main
git branch -D v2
git push origin --delete v2  # only if you already pushed
```

No v1 state is touched by phase 0 because `storage/v2/` is a new directory and `config/default.yaml` only adds a new section (v1 code ignores it).

---

## Report-Back

Use the template from `02-testing-standards.md`. Specifically include:

- The commit hash for the phase 0 commit
- The mypy and ruff baseline counts you captured
- Confirmation that `load_config()` returns a populated `V2Config`
- Confirmation that the daemon smoke test ran without errors
- Any unexpected issues or deviations (should be none for phase 0)

Only report phase 0 complete when every acceptance criterion is ✓. Proceed to phase 1 after user acknowledgment.
