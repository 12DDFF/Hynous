# Issue 2: Per-Section Decay Curves — Implementation Guide

> **STATUS:** DONE (2026-02-21)
>
> **Depends on:** Issue 0 (Section Foundation) — must be implemented first.
>
> **What this changes:** Every memory type currently decays using the same global FSRS parameters — same initial stability, same growth rate, same lifecycle thresholds. After this guide, each memory section has its own decay curve: signals decay in days, episodic memories in weeks, knowledge in months, and procedural memory in quarters. The `computeDecay()`, `getNeuralDefaults()`, `updateStabilityOnAccess()`, and `getDecayLifecycleState()` functions become section-aware, using per-section parameters from `SECTION_PROFILES` instead of the single global `DECAY_CONFIG`.

---

## Problem Statement

The FSRS decay system uses **one global configuration** for all memories:

```
Current (global, identical for every node):
  growth_rate:        2.5     (stability multiplier on recall)
  max_stability_days: 365     (cap)
  active_threshold:   0.5     (R > 0.5 = ACTIVE)
  weak_threshold:     0.1     (R > 0.1 = WEAK, else DORMANT)
  dormant_days:       60      (days at low R before DORMANT status)
  compress_days:      120     (days before compression eligible)
  archive_days:       240     (days before archive eligible)
```

And initial stability is determined by a coarse 7-category `AlgorithmNodeType` system (`person`, `fact`, `concept`, `event`, `note`, `document`, `preference`) — a mapping that **poorly fits the agent's actual subtypes**:

```
Current subtype → AlgorithmNodeType → initial stability:
  custom:signal   → 'fact'    → 7 days     (should be ~2 days)
  custom:lesson   → 'fact'    → 7 days     (should be ~90 days!)
  custom:playbook → (unmapped) → 'concept' → 21 days (should be ~180 days!)
  custom:trade_entry → 'concept' → 21 days  (reasonable, but should be per-subtype)
```

A hard-won lesson that saved the agent from a catastrophic loss has the **same 7-day initial stability** as a routine market signal. A validated playbook decays at the same rate as a curiosity item. The FSRS growth rate, lifecycle thresholds, and max stability cap are identical for all types.

**What this guide does:** Replaces the global `DECAY_CONFIG` dispatch in four key functions with per-section lookups from `SECTION_PROFILES` (defined in Issue 0). Also replaces the `SUBTYPE_TO_ALGO_TYPE` → `getInitialStability()` chain with the section-aware `getInitialStabilityForSubtype()` from `@nous/core/sections`. No Python changes required — all decay computations happen server-side in Nous TypeScript.

---

## Required Reading

Read these files **in order** before implementing. The "Focus Areas" column tells you exactly which parts matter.

### Foundation (read first)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 1 | `revisions/memory-sections/executive-summary.md` | The theory document. Defines all 6 issues and the design constraint that sections are a bias layer, not partitions. | "Issue 2: Uniform FSRS Decay Curves" (lines 150-195) — the full problem statement with per-subtype analysis |
| 2 | `revisions/memory-sections/issue-0-section-foundation.md` | The foundation guide you're building on. Defines section types, `SECTION_PROFILES` with per-section `SectionDecayConfig`, `SUBTYPE_INITIAL_STABILITY` per-subtype overrides, and `getInitialStabilityForSubtype()`. | Step 0.1 code block: `SectionDecayConfig` interface (lines 196-207), `SECTION_PROFILES` decay values (lines 268-274, 295-301, 322-328, 349-355), `SUBTYPE_INITIAL_STABILITY` (lines 426-449), `getInitialStabilityForSubtype()` (lines 455-461) |
| 3 | `revisions/memory-sections/issue-1-retrieval-weights.md` | The sibling guide for Issue 1 (per-section reranking). Shows the pattern for how to thread section data through existing functions. Independent of this guide — both depend only on Guide 0. | Skim Steps 1.1-1.5 to understand the "add field, thread through, switch function call" pattern |

### TypeScript Decay System (understand the data flow — these are the files you will modify)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 4 | `nous-server/core/src/params/index.ts` | **PRIMARY MODIFICATION TARGET.** Houses the global `DECAY_CONFIG` (lines 214-224), `INITIAL_STABILITY` (lines 229-237), `INITIAL_DIFFICULTY` (lines 242-250), `calculateRetrievability()` (line 921), `updateStabilityOnAccess()` (lines 947-953), `getDecayLifecycleState()` (lines 958-965), `getInitialStability()` (line 980), `getInitialDifficulty()` (line 987), `DecayConfig` interface (lines 190-200). | Lines 190-258 (all decay constants + interfaces), lines 917-989 (all decay functions). Read EVERY LINE in these ranges. |
| 5 | `nous-server/server/src/core-bridge.ts` | **PRIMARY MODIFICATION TARGET.** Houses `SUBTYPE_TO_ALGO_TYPE` (lines 30-45), `getAlgoType()` (lines 56-61), `computeDecay()` (lines 111-128), `computeStabilityGrowth()` (lines 154-159), `getNeuralDefaults()` (lines 166-177). All of these use the global `DECAY_CONFIG` and `INITIAL_STABILITY` — this guide replaces them with section-aware versions. | Lines 9-20 (imports), lines 30-61 (type mappings), lines 105-177 (decay + defaults). Read EVERY LINE. |
| 6 | `nous-server/server/src/routes/decay.ts` | **MODIFICATION TARGET.** The batch decay endpoint called by the daemon every 6 hours. Calls `computeDecay()` per node. After this guide, each node is decayed using its section's thresholds. | Full file (76 lines). Read every line. |
| 7 | `nous-server/server/src/routes/nodes.ts` | Node CRUD. `POST /nodes` (line 40) calls `getNeuralDefaults()` — after this guide, uses section-aware initial stability. `GET /nodes/:id` (line 143) calls `computeStabilityGrowth()` — after this guide, uses section-aware growth rate. | Lines 1-12 (imports), lines 30-56 (POST create, especially line 40), lines 130-166 (GET with stability growth) |

### TypeScript Section Foundation (understand what's available from Issue 0)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 8 | `nous-server/core/src/sections/index.ts` | The section module created in Issue 0. You will import `getSectionForSubtype()`, `getInitialStabilityForSubtype()`, and `SECTION_PROFILES` from here. | `SectionDecayConfig` interface, `SECTION_PROFILES` (all 4 sections' decay configs), `SUBTYPE_INITIAL_STABILITY`, `getInitialStabilityForSubtype()` |

### Build & Test Patterns

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 9 | `nous-server/core/tsup.config.ts` | Build entry points. Already includes `src/sections/index.ts` from Guide 0. No changes needed. | Full file (34 lines) |
| 10 | `nous-server/core/src/params/index.test.ts` | Existing decay tests (lines 617-747). Your changes must not break these. Shows test patterns for `calculateRetrievability`, `updateStabilityOnAccess`, `getDecayLifecycleState`, `getInitialStability`. | Lines 617-747 (all decay test blocks) |
| 11 | `nous-server/core/src/sections/__tests__/sections.test.ts` | Section tests from Guide 0. Validates section profiles, stability overrides, mappings. No changes needed — run to verify no regressions. | Full file (skim for test structure) |

---

## Architecture Decisions

### Decision 1: New section-aware functions alongside existing global functions (FINAL)

Rather than modifying the existing `getDecayLifecycleState()` and `updateStabilityOnAccess()` signatures (which would break all existing callers and tests), we add new section-aware variants:

- `getDecayLifecycleStateForSection(retrievability, daysDormant, sectionDecay)` — accepts a `SectionDecayConfig` instead of using global `DECAY_CONFIG`
- `updateStabilityOnAccessForSection(stability, difficulty, sectionDecay)` — accepts a `SectionDecayConfig` for growth rate and max stability

The original functions remain for backward compatibility. All production call sites (`computeDecay`, `computeStabilityGrowth`, `getNeuralDefaults`) switch to the new variants. The old functions become legacy wrappers.

**Where:** New functions in `params/index.ts`, called from modified functions in `core-bridge.ts`.

### Decision 2: `getNeuralDefaults()` uses `getInitialStabilityForSubtype()` from sections (FINAL)

The current chain is: `subtype → getAlgoType() → getInitialStability()` which maps through the coarse 7-category `AlgorithmNodeType` system. The new chain is: `subtype → getInitialStabilityForSubtype()` which directly looks up per-subtype stability from `SUBTYPE_INITIAL_STABILITY` in the sections module.

Initial difficulty still uses the existing `INITIAL_DIFFICULTY` map via `AlgorithmNodeType` — difficulty is less critical to differentiate per-subtype and the existing values are reasonable.

**Where:** `core-bridge.ts` `getNeuralDefaults()`.

### Decision 3: `computeDecay()` uses per-section lifecycle thresholds (FINAL)

The current `computeDecay()` uses global `DECAY_CONFIG.active_threshold` and `DECAY_CONFIG.weak_threshold` for ALL nodes. After this guide, it looks up the node's section via `getSectionForSubtype(row.subtype)`, gets that section's `SectionDecayConfig`, and passes section-specific thresholds to `getDecayLifecycleStateForSection()`.

This means:
- A KNOWLEDGE node (lesson) with `active_threshold: 0.4` stays ACTIVE longer than a SIGNALS node with `active_threshold: 0.5` at the same retrievability
- A PROCEDURAL node (playbook) with `weak_threshold: 0.03` resists going DORMANT far longer than a SIGNALS node with `weak_threshold: 0.15`

**Where:** `core-bridge.ts` `computeDecay()`.

### Decision 4: `computeStabilityGrowth()` uses per-section growth rate (FINAL)

The current `computeStabilityGrowth()` passes through to `updateStabilityOnAccess()` which uses `DECAY_CONFIG.growth_rate` (2.5) for all nodes. After this guide, it looks up the section-specific growth rate and max stability:

- SIGNALS: growth_rate 1.5, max 30 days (signal access strengthens slowly, caps quickly)
- EPISODIC: growth_rate 2.0, max 180 days (trade access moderately strengthens)
- KNOWLEDGE: growth_rate 3.0, max 365 days (lesson recall strongly reinforces)
- PROCEDURAL: growth_rate 3.5, max 365 days (playbook recall very strongly reinforces)

**Where:** `core-bridge.ts` `computeStabilityGrowth()`.

### Decision 5: No migration for existing nodes (FINAL)

Existing nodes keep their current `neural_stability`, `neural_difficulty`, and `neural_retrievability` values. The new per-section parameters affect:

1. **Newly created nodes** — get section-aware initial stability from `getInitialStabilityForSubtype()`
2. **Stability growth on access** — next recall uses section-specific `growth_rate` and `max_stability_days`
3. **Lifecycle transitions** — next decay cycle uses section-specific `active_threshold` and `weak_threshold`

Existing nodes will naturally migrate to section-appropriate behavior as they are accessed (stability grows with section rate) and as decay cycles run (lifecycle uses section thresholds). No batch retroactive recalculation is needed.

### Decision 6: Dead branch in `getDecayLifecycleState()` is noted but NOT fixed (FINAL)

The existing `getDecayLifecycleState()` at lines 961-962 has a dead branch:
```typescript
if (daysDormant < DECAY_CONFIG.dormant_days) return 'DORMANT';   // line 961
if (daysDormant < DECAY_CONFIG.compress_days) return 'DORMANT';  // line 962 — UNREACHABLE
```

Line 962 is unreachable because `dormant_days (60) < compress_days (120)` — if line 961 doesn't match, daysDormant >= 60, and line 962 would be `60 < 120` which is true, but line 961 already returned for `< 60`. The intent was likely `return 'COMPRESS'` on line 962.

The new `getDecayLifecycleStateForSection()` function fixes this bug in its implementation. The old function is left as-is for backward compatibility.

---

## Implementation Steps

### Step 2.1: Add section-aware decay functions to params

**File:** `nous-server/core/src/params/index.ts`

Add two new exported functions immediately after the existing decay functions. These accept a `SectionDecayConfig` parameter instead of using the global `DECAY_CONFIG`.

**First, add the import for sections.** Find the import block at the top of the file.

**Find this** (line 17):
```typescript
import { z } from 'zod';
```

Check if the sections import already exists (it may have been added by Issue 1). If NOT present, add it:

**Replace with:**
```typescript
import { z } from 'zod';
import type { SectionDecayConfig } from '../sections/index.js';
```

If Issue 1 was already implemented, the import line may look like:
```typescript
import { z } from 'zod';
import { getSectionForSubtype, SECTION_PROFILES } from '../sections/index.js';
```

In that case, add the type import to the existing line:
```typescript
import { z } from 'zod';
import { getSectionForSubtype, SECTION_PROFILES, type SectionDecayConfig } from '../sections/index.js';
```

**Then, add the new functions.** Find the end of the existing decay functions block.

**Find this** (lines 984-989):
```typescript
/**
 * Gets initial difficulty for a node type.
 */
export function getInitialDifficulty(type: AlgorithmNodeType): number {
  return INITIAL_DIFFICULTY[type] ?? 0.3;
}
```

**Insert AFTER** (after line 989, before the next section header):
```typescript

/**
 * Gets decay lifecycle state using per-section thresholds.
 *
 * Unlike getDecayLifecycleState() which uses global DECAY_CONFIG,
 * this variant accepts a SectionDecayConfig so each memory section
 * can have different active/weak thresholds and lifecycle timing.
 *
 * Also fixes the dead branch bug in the original function where
 * COMPRESS was unreachable (line 962 returned 'DORMANT' instead of 'COMPRESS').
 *
 * @param retrievability Current R value (0-1)
 * @param daysDormant Days the node has been below weak_threshold
 * @param decay Section-specific decay configuration
 * @returns Lifecycle state: ACTIVE | WEAK | DORMANT | COMPRESS | ARCHIVE
 *
 * @see revisions/memory-sections/issue-2-decay-curves.md
 */
export function getDecayLifecycleStateForSection(
  retrievability: number,
  daysDormant: number,
  decay: SectionDecayConfig,
): DecayLifecycleState {
  if (retrievability > decay.active_threshold) return 'ACTIVE';
  if (retrievability > decay.weak_threshold) return 'WEAK';
  // Below weak_threshold — use dormant/compress/archive timing from global DECAY_CONFIG
  // (These day-based thresholds are uniform across sections — only R-based thresholds differ)
  if (daysDormant < DECAY_CONFIG.dormant_days) return 'DORMANT';
  if (daysDormant < DECAY_CONFIG.compress_days) return 'COMPRESS';  // Fixed: was 'DORMANT' (dead branch)
  if (daysDormant < DECAY_CONFIG.archive_days) return 'ARCHIVE';
  return 'ARCHIVE';
}

/**
 * Updates stability on access using per-section growth rate and max stability.
 *
 * Unlike updateStabilityOnAccess() which uses global DECAY_CONFIG,
 * this variant accepts a SectionDecayConfig so each memory section
 * can have different reinforcement strength and stability caps.
 *
 * @param stability Current stability in days
 * @param difficulty Node difficulty (0-1)
 * @param decay Section-specific decay configuration
 * @returns New stability in days (capped at section's max_stability_days)
 *
 * @see revisions/memory-sections/issue-2-decay-curves.md
 */
export function updateStabilityOnAccessForSection(
  stability: number,
  difficulty: number,
  decay: SectionDecayConfig,
): number {
  const difficultyFactor = 1 - (difficulty * 0.5);
  return Math.min(
    stability * decay.growth_rate * difficultyFactor,
    decay.max_stability_days,
  );
}
```

**Why two new functions instead of modifying originals:** The existing `getDecayLifecycleState()` and `updateStabilityOnAccess()` are tested extensively (lines 687-707 and 669-685 in `index.test.ts`). Modifying their signatures would break those tests and any direct callers. The new functions are the production path; the old ones remain for backward compat and direct testing.

---

### Step 2.2: Modify `getNeuralDefaults()` to use section-aware initial stability

**File:** `nous-server/server/src/core-bridge.ts`

The current function uses `getAlgoType() → getInitialStability()` — a coarse 7-category mapping. Replace with direct section-aware lookup.

**First, update the imports.** Find the imports at the top of the file.

**Find this** (lines 9-25):
```typescript
import {
  calculateRetrievability,
  getDecayLifecycleState,
  updateStabilityOnAccess,
  getInitialStability,
  getInitialDifficulty,
  DECAY_CONFIG,
  SSA_EDGE_WEIGHTS,
  type ScoredNode,
  type AlgorithmNodeType,
  type DecayLifecycleState,
} from '@nous/core/params';

import {
  getSectionForSubtype,
  type MemorySection,
} from '@nous/core/sections';
```

**Replace with:**
```typescript
import {
  calculateRetrievability,
  getDecayLifecycleState,
  getDecayLifecycleStateForSection,
  updateStabilityOnAccess,
  updateStabilityOnAccessForSection,
  getInitialStability,
  getInitialDifficulty,
  DECAY_CONFIG,
  SSA_EDGE_WEIGHTS,
  type ScoredNode,
  type AlgorithmNodeType,
  type DecayLifecycleState,
} from '@nous/core/params';

import {
  getSectionForSubtype,
  getInitialStabilityForSubtype,
  SECTION_PROFILES,
  type MemorySection,
} from '@nous/core/sections';
```

**Then, modify `getNeuralDefaults()`.**

**Find this** (lines 161-177):
```typescript
// ---- Neural Defaults for New Nodes ----

/**
 * Get FSRS-appropriate neural defaults for a new node.
 */
export function getNeuralDefaults(type: string, subtype?: string | null): {
  neural_stability: number;
  neural_retrievability: number;
  neural_difficulty: number;
} {
  const algoType = getAlgoType(type, subtype);
  return {
    neural_stability: getInitialStability(algoType),
    neural_retrievability: 1.0, // just created = perfect recall
    neural_difficulty: getInitialDifficulty(algoType),
  };
}
```

**Replace with:**
```typescript
// ---- Neural Defaults for New Nodes ----

/**
 * Get FSRS-appropriate neural defaults for a new node.
 *
 * Uses per-subtype initial stability from @nous/core/sections
 * (Issue 2: per-section decay curves) instead of the coarse
 * AlgorithmNodeType → INITIAL_STABILITY chain.
 *
 * Initial difficulty still uses AlgorithmNodeType — less critical
 * to differentiate per-subtype.
 */
export function getNeuralDefaults(type: string, subtype?: string | null): {
  neural_stability: number;
  neural_retrievability: number;
  neural_difficulty: number;
} {
  const algoType = getAlgoType(type, subtype);
  return {
    neural_stability: getInitialStabilityForSubtype(subtype),  // Section-aware (Issue 2)
    neural_retrievability: 1.0, // just created = perfect recall
    neural_difficulty: getInitialDifficulty(algoType),
  };
}
```

**What changes:** `getInitialStability(algoType)` → `getInitialStabilityForSubtype(subtype)`. This replaces the coarse `subtype → AlgorithmNodeType → INITIAL_STABILITY[type]` chain with the direct `subtype → SUBTYPE_INITIAL_STABILITY[subtype]` lookup. Example impact:

| Subtype | Before (via AlgorithmNodeType) | After (via sections) |
|---------|-------------------------------|---------------------|
| `custom:signal` | `fact` → 7 days | 2 days |
| `custom:lesson` | `fact` → 7 days | 90 days |
| `custom:playbook` | `concept` → 21 days | 180 days |
| `custom:trade_entry` | `concept` → 21 days | 21 days (same) |
| `custom:turn_summary` | `event` → 10 days | 7 days |
| `custom:curiosity` | `concept` → 21 days | 14 days |
| `custom:watchpoint` | `concept` → 21 days | 5 days |
| `custom:thesis` | `concept` → 21 days | 30 days |

---

### Step 2.3: Modify `computeDecay()` to use per-section lifecycle thresholds

**File:** `nous-server/server/src/core-bridge.ts`

**Find this** (lines 105-128):
```typescript
// ---- FSRS Decay Application ----

/**
 * Compute current retrievability and lifecycle state from a node row.
 * Pure function — does not modify the row or write to DB.
 */
export function computeDecay(row: NodeRow): {
  retrievability: number;
  lifecycle_state: DecayLifecycleState;
  days_since_access: number;
} {
  const lastAccessed = row.neural_last_accessed
    ? new Date(row.neural_last_accessed)
    : new Date(row.provenance_created_at);
  const daysSinceAccess = Math.max(0, (Date.now() - lastAccessed.getTime()) / 86_400_000);

  const retrievability = calculateRetrievability(daysSinceAccess, row.neural_stability);

  // Days dormant = days below weak threshold
  const daysDormant = retrievability < DECAY_CONFIG.weak_threshold ? daysSinceAccess : 0;
  const lifecycle_state = getDecayLifecycleState(retrievability, daysDormant);

  return { retrievability, lifecycle_state, days_since_access: daysSinceAccess };
}
```

**Replace with:**
```typescript
// ---- FSRS Decay Application ----

/**
 * Compute current retrievability and lifecycle state from a node row.
 * Pure function — does not modify the row or write to DB.
 *
 * Uses per-section lifecycle thresholds (Issue 2: per-section decay curves).
 * Each section has its own active_threshold and weak_threshold, so a KNOWLEDGE
 * node (active_threshold: 0.4) stays ACTIVE longer than a SIGNALS node
 * (active_threshold: 0.5) at the same retrievability.
 */
export function computeDecay(row: NodeRow): {
  retrievability: number;
  lifecycle_state: DecayLifecycleState;
  days_since_access: number;
} {
  const lastAccessed = row.neural_last_accessed
    ? new Date(row.neural_last_accessed)
    : new Date(row.provenance_created_at);
  const daysSinceAccess = Math.max(0, (Date.now() - lastAccessed.getTime()) / 86_400_000);

  const retrievability = calculateRetrievability(daysSinceAccess, row.neural_stability);

  // Look up per-section decay thresholds
  const section = getSectionForSubtype(row.subtype);
  const sectionDecay = SECTION_PROFILES[section].decay;

  // Days dormant = days below this section's weak threshold
  const daysDormant = retrievability < sectionDecay.weak_threshold ? daysSinceAccess : 0;
  const lifecycle_state = getDecayLifecycleStateForSection(retrievability, daysDormant, sectionDecay);

  return { retrievability, lifecycle_state, days_since_access: daysSinceAccess };
}
```

**What changes:**
1. `DECAY_CONFIG.weak_threshold` → `sectionDecay.weak_threshold` (per-section threshold for dormancy calculation)
2. `getDecayLifecycleState(retrievability, daysDormant)` → `getDecayLifecycleStateForSection(retrievability, daysDormant, sectionDecay)` (per-section active/weak thresholds)

**Impact example:** A `custom:playbook` node (PROCEDURAL section, `weak_threshold: 0.03`) won't start accumulating dormant days until retrievability drops below 0.03 — far below the global 0.10. A `custom:signal` node (SIGNALS section, `weak_threshold: 0.15`) starts accumulating dormant days at retrievability 0.15 — above the global 0.10.

---

### Step 2.4: Modify `computeStabilityGrowth()` to use per-section growth rate

**File:** `nous-server/server/src/core-bridge.ts`

**Find this** (lines 148-159):
```typescript
// ---- Stability Update on Access ----

/**
 * Calculate new stability after a recall event (FSRS growth).
 * Returns the new stability value (in days).
 */
export function computeStabilityGrowth(
  currentStability: number,
  difficulty: number,
): number {
  return updateStabilityOnAccess(currentStability, difficulty);
}
```

**Replace with:**
```typescript
// ---- Stability Update on Access ----

/**
 * Calculate new stability after a recall event (FSRS growth).
 * Returns the new stability value (in days).
 *
 * Uses per-section growth rate and max stability (Issue 2: per-section decay curves).
 * KNOWLEDGE nodes grow stability faster (3.0) and can reach 365 days,
 * while SIGNALS nodes grow slowly (1.5) and cap at 30 days.
 */
export function computeStabilityGrowth(
  currentStability: number,
  difficulty: number,
  subtype?: string | null,
): number {
  const section = getSectionForSubtype(subtype);
  const sectionDecay = SECTION_PROFILES[section].decay;
  return updateStabilityOnAccessForSection(currentStability, difficulty, sectionDecay);
}
```

**What changes:**
1. Added optional `subtype` parameter (backward compatible — defaults to `null` → KNOWLEDGE section)
2. Looks up section-specific `SectionDecayConfig`
3. Uses `updateStabilityOnAccessForSection()` with section-specific `growth_rate` and `max_stability_days`

**Impact example:** When a `custom:lesson` (KNOWLEDGE, growth_rate: 3.0) is accessed with stability 10 and difficulty 0.4:
- Before: `10 × 2.5 × 0.8 = 20.0` (global growth_rate 2.5)
- After: `10 × 3.0 × 0.8 = 24.0` (KNOWLEDGE growth_rate 3.0), capped at 365

When a `custom:signal` (SIGNALS, growth_rate: 1.5) is accessed with stability 2 and difficulty 0.2:
- Before: `2 × 2.5 × 0.9 = 4.5` (global growth_rate 2.5)
- After: `2 × 1.5 × 0.9 = 2.7` (SIGNALS growth_rate 1.5), capped at 30

---

### Step 2.5: Update `GET /nodes/:id` to pass subtype to stability growth

**File:** `nous-server/server/src/routes/nodes.ts`

The GET handler calls `computeStabilityGrowth()` — now needs to pass `subtype` so it can use section-specific growth rate.

**Find this** (lines 142-146):
```typescript
  // Strengthen stability on access (recall event)
  const newStability = computeStabilityGrowth(
    row.neural_stability,
    row.neural_difficulty,
  );
```

**Replace with:**
```typescript
  // Strengthen stability on access (recall event) — per-section growth rate (Issue 2)
  const newStability = computeStabilityGrowth(
    row.neural_stability,
    row.neural_difficulty,
    row.subtype,
  );
```

**What changes:** Passes `row.subtype` to `computeStabilityGrowth()` so it uses the correct section's growth rate.

---

### Step 2.6: Verify decay route uses updated `computeDecay()`

**File:** `nous-server/server/src/routes/decay.ts`

The batch decay endpoint at `POST /decay` already calls `computeDecay(nodeRow)` — and since we modified `computeDecay()` in Step 2.3 to be section-aware, the decay route **automatically gets per-section behavior** without any code changes to this file.

**No code changes needed in decay.ts** — verify by reading the file and confirming it calls `computeDecay(nodeRow)` which now internally uses per-section thresholds.

However, the response should be enhanced to include section information in transitions for debugging:

**Find this** (lines 44-56):
```typescript
      updates.push({
        sql: 'UPDATE nodes SET neural_retrievability = ?, state_lifecycle = ? WHERE id = ?',
        args: [Math.round(retrievability * 10000) / 10000, lifecycle_state, nodeRow.id],
      });

      if (lifecycle_state !== currentLifecycle) {
        transitions.push({
          id: nodeRow.id,
          from: currentLifecycle,
          to: lifecycle_state,
        });
      }
```

**Replace with:**
```typescript
      updates.push({
        sql: 'UPDATE nodes SET neural_retrievability = ?, state_lifecycle = ? WHERE id = ?',
        args: [Math.round(retrievability * 10000) / 10000, lifecycle_state, nodeRow.id],
      });

      if (lifecycle_state !== currentLifecycle) {
        transitions.push({
          id: nodeRow.id,
          from: currentLifecycle,
          to: lifecycle_state,
          subtype: nodeRow.subtype ?? 'unknown',
        });
      }
```

**And update the transitions type** at line 30:

**Find this** (line 30):
```typescript
  const transitions: { id: string; from: string; to: string }[] = [];
```

**Replace with:**
```typescript
  const transitions: { id: string; from: string; to: string; subtype: string }[] = [];
```

**Why:** Adding `subtype` to transition logs makes it easy to verify that per-section decay is working — you can see that signals transition faster than lessons in the decay response.

---

### Step 2.7: Build and verify

After all TypeScript changes are made, rebuild the core module and verify.

**Commands to run (from project root):**
```bash
cd nous-server/core
npx tsup
```

**Expected output:** Build succeeds with no errors.

**Verify the new functions are importable:**
```bash
cd nous-server/server
node -e "
const p = await import('@nous/core/params');
const s = await import('@nous/core/sections');
console.log('getDecayLifecycleStateForSection exists:', typeof p.getDecayLifecycleStateForSection === 'function');
console.log('updateStabilityOnAccessForSection exists:', typeof p.updateStabilityOnAccessForSection === 'function');
console.log('getInitialStabilityForSubtype exists:', typeof s.getInitialStabilityForSubtype === 'function');
console.log('Signal initial stability:', s.getInitialStabilityForSubtype('custom:signal'));
console.log('Lesson initial stability:', s.getInitialStabilityForSubtype('custom:lesson'));
console.log('Playbook initial stability:', s.getInitialStabilityForSubtype('custom:playbook'));
"
```

**Expected output:**
```
getDecayLifecycleStateForSection exists: true
updateStabilityOnAccessForSection exists: true
getInitialStabilityForSubtype exists: true
Signal initial stability: 2
Lesson initial stability: 90
Playbook initial stability: 180
```

---

## Per-Section Decay Profiles

These are the decay profiles from `SECTION_PROFILES` (defined in Issue 0's `sections/index.ts`). Reproduced here for reference.

### Section Decay Configs

| Parameter | EPISODIC | SIGNALS | KNOWLEDGE | PROCEDURAL | Global (old) |
|-----------|----------|---------|-----------|------------|-------------|
| initial_stability_days | 14 | 2 | 60 | 120 | N/A (per-type) |
| growth_rate | 2.0 | 1.5 | **3.0** | **3.5** | 2.5 |
| active_threshold | 0.5 | 0.5 | **0.4** | **0.3** | 0.5 |
| weak_threshold | 0.1 | **0.15** | **0.05** | **0.03** | 0.1 |
| max_stability_days | **180** | **30** | 365 | 365 | 365 |

### Per-Subtype Initial Stability (overrides section default)

| Subtype | Section | Section Default | Override | Old Value (via AlgorithmNodeType) |
|---------|---------|----------------|----------|----------------------------------|
| `custom:trade_entry` | EPISODIC | 14d | **21d** | 21d (concept) |
| `custom:trade_close` | EPISODIC | 14d | **21d** | 21d (concept) |
| `custom:trade_modify` | EPISODIC | 14d | 14d | 21d (concept) |
| `custom:trade` | EPISODIC | 14d | 14d | 7d (fact) |
| `custom:turn_summary` | EPISODIC | 14d | **7d** | 10d (event) |
| `custom:session_summary` | EPISODIC | 14d | 14d | 30d (note) |
| `custom:market_event` | EPISODIC | 14d | **10d** | 10d (event) |
| `custom:signal` | SIGNALS | 2d | 2d | 7d (fact) |
| `custom:watchpoint` | SIGNALS | 2d | **5d** | 21d (concept) |
| `custom:lesson` | KNOWLEDGE | 60d | **90d** | 7d (fact) |
| `custom:thesis` | KNOWLEDGE | 60d | **30d** | 21d (concept) |
| `custom:curiosity` | KNOWLEDGE | 60d | **14d** | 21d (concept) |
| `custom:playbook` | PROCEDURAL | 120d | **180d** | 21d (concept) |
| `custom:missed_opportunity` | PROCEDURAL | 120d | **30d** | (unmapped → concept 21d) |
| `custom:good_pass` | PROCEDURAL | 120d | **30d** | (unmapped → concept 21d) |

### Design Rationale Per Section

**EPISODIC** (trades, summaries): Medium decay profile. Trade records are valuable for weeks as recent trading context but don't need to persist indefinitely. `growth_rate: 2.0` means accessing a trade memory moderately reinforces it. `max_stability_days: 180` caps at 6 months — old trades should eventually fade as the market regime changes.

**SIGNALS** (signals, watchpoints): Aggressive decay profile. Market signals are useful for hours to days. A funding rate spike from 3 days ago is stale noise. `growth_rate: 1.5` means even repeated access barely reinforces — signals should die quickly regardless. `max_stability_days: 30` hard caps at one month. `weak_threshold: 0.15` means signals enter WEAK lifecycle earlier than other types, making them eligible for pruning sooner.

**KNOWLEDGE** (lessons, theses, curiosity): Slow decay profile. Trading lessons are the agent's accumulated wisdom. `growth_rate: 3.0` means each recall significantly reinforces — lessons get stronger with use. `active_threshold: 0.4` means lessons stay ACTIVE at lower retrievability than signals/episodic (tolerant of gaps between recalls). `weak_threshold: 0.05` means lessons resist going DORMANT until nearly forgotten. `max_stability_days: 365` allows up to a year of stability.

**PROCEDURAL** (playbooks, missed opportunities, good passes): Most durable decay profile. Validated playbooks should be nearly permanent. `growth_rate: 3.5` provides the strongest reinforcement. `active_threshold: 0.3` and `weak_threshold: 0.03` mean playbooks stay ACTIVE and resist DORMANT far longer than any other type. A playbook accessed every few months stays ACTIVE indefinitely.

---

## Testing

### Unit Tests (TypeScript)

**New file:** `nous-server/core/src/params/section-decay.test.ts`

```typescript
/**
 * Tests for per-section decay curve functions (Issue 2).
 *
 * Tests the new section-aware variants: getDecayLifecycleStateForSection()
 * and updateStabilityOnAccessForSection().
 */
import { describe, it, expect } from 'vitest';
import {
  calculateRetrievability,
  getDecayLifecycleState,
  getDecayLifecycleStateForSection,
  updateStabilityOnAccess,
  updateStabilityOnAccessForSection,
  DECAY_CONFIG,
} from './index.js';
import {
  SECTION_PROFILES,
  SUBTYPE_INITIAL_STABILITY,
  getInitialStabilityForSubtype,
  getSectionForSubtype,
  type SectionDecayConfig,
} from '../sections/index.js';

// ============================================================
// getDecayLifecycleStateForSection
// ============================================================

describe('getDecayLifecycleStateForSection', () => {
  describe('basic lifecycle transitions', () => {
    const knowledgeDecay = SECTION_PROFILES.KNOWLEDGE.decay;

    it('returns ACTIVE for high retrievability', () => {
      expect(getDecayLifecycleStateForSection(0.8, 0, knowledgeDecay)).toBe('ACTIVE');
    });

    it('returns WEAK for medium retrievability', () => {
      expect(getDecayLifecycleStateForSection(0.2, 0, knowledgeDecay)).toBe('WEAK');
    });

    it('returns DORMANT for low retrievability with few dormant days', () => {
      expect(getDecayLifecycleStateForSection(0.01, 30, knowledgeDecay)).toBe('DORMANT');
    });

    it('returns COMPRESS for extended dormancy', () => {
      // dormant_days=60, compress_days=120 (from global DECAY_CONFIG)
      expect(getDecayLifecycleStateForSection(0.01, 90, knowledgeDecay)).toBe('COMPRESS');
    });

    it('returns ARCHIVE for very long dormancy', () => {
      expect(getDecayLifecycleStateForSection(0.01, 250, knowledgeDecay)).toBe('ARCHIVE');
    });
  });

  describe('per-section threshold differences', () => {
    it('KNOWLEDGE stays ACTIVE at lower R than SIGNALS', () => {
      const knowledgeDecay = SECTION_PROFILES.KNOWLEDGE.decay;  // active_threshold: 0.4
      const signalsDecay = SECTION_PROFILES.SIGNALS.decay;      // active_threshold: 0.5

      // R = 0.45 — ACTIVE for KNOWLEDGE, WEAK for SIGNALS
      expect(getDecayLifecycleStateForSection(0.45, 0, knowledgeDecay)).toBe('ACTIVE');
      expect(getDecayLifecycleStateForSection(0.45, 0, signalsDecay)).toBe('WEAK');
    });

    it('PROCEDURAL stays ACTIVE at even lower R', () => {
      const proceduralDecay = SECTION_PROFILES.PROCEDURAL.decay;  // active_threshold: 0.3

      // R = 0.35 — still ACTIVE for PROCEDURAL
      expect(getDecayLifecycleStateForSection(0.35, 0, proceduralDecay)).toBe('ACTIVE');
    });

    it('SIGNALS enters WEAK at higher R than others', () => {
      const signalsDecay = SECTION_PROFILES.SIGNALS.decay;        // weak_threshold: 0.15
      const knowledgeDecay = SECTION_PROFILES.KNOWLEDGE.decay;    // weak_threshold: 0.05

      // R = 0.12 — DORMANT for SIGNALS (< 0.15), still WEAK for KNOWLEDGE (> 0.05)
      expect(getDecayLifecycleStateForSection(0.12, 0, signalsDecay)).toBe('DORMANT');
      expect(getDecayLifecycleStateForSection(0.12, 0, knowledgeDecay)).toBe('WEAK');
    });

    it('PROCEDURAL resists DORMANT with very low weak_threshold', () => {
      const proceduralDecay = SECTION_PROFILES.PROCEDURAL.decay;  // weak_threshold: 0.03

      // R = 0.04 — still WEAK for PROCEDURAL (> 0.03)
      expect(getDecayLifecycleStateForSection(0.04, 0, proceduralDecay)).toBe('WEAK');
    });
  });

  describe('fixes dead branch bug from original', () => {
    it('returns COMPRESS (not DORMANT) for days between dormant_days and compress_days', () => {
      const decay = SECTION_PROFILES.KNOWLEDGE.decay;

      // daysDormant = 90, which is > dormant_days (60) and < compress_days (120)
      // Original function had dead branch: returned 'DORMANT' here
      // New function correctly returns 'COMPRESS'
      expect(getDecayLifecycleStateForSection(0.01, 90, decay)).toBe('COMPRESS');
    });

    it('original function has dead branch (returns DORMANT instead of COMPRESS)', () => {
      // This documents the known bug in the original function
      // daysDormant = 90: > dormant_days (60), < compress_days (120)
      // Line 961: 90 < 60? No, skip
      // Line 962: 90 < 120? Yes, return 'DORMANT' — BUG (should be 'COMPRESS')
      const originalResult = getDecayLifecycleState(0.05, 90);
      // The original returns 'DORMANT' here, but the correct answer is 'COMPRESS'
      expect(originalResult).toBe('DORMANT');  // Documenting the bug

      // The new function returns the correct state
      const fixedResult = getDecayLifecycleStateForSection(0.05, 90, SECTION_PROFILES.KNOWLEDGE.decay);
      expect(fixedResult).toBe('COMPRESS');    // Fixed
    });
  });

  describe('all four sections have valid decay configs', () => {
    for (const [section, profile] of Object.entries(SECTION_PROFILES)) {
      it(`${section} has valid thresholds (weak < active)`, () => {
        expect(profile.decay.weak_threshold).toBeLessThan(profile.decay.active_threshold);
      });

      it(`${section} transitions correctly through all states`, () => {
        const d = profile.decay;
        expect(getDecayLifecycleStateForSection(d.active_threshold + 0.1, 0, d)).toBe('ACTIVE');
        expect(getDecayLifecycleStateForSection((d.active_threshold + d.weak_threshold) / 2, 0, d)).toBe('WEAK');
        expect(getDecayLifecycleStateForSection(d.weak_threshold - 0.01, 30, d)).toBe('DORMANT');
        expect(getDecayLifecycleStateForSection(d.weak_threshold - 0.01, 90, d)).toBe('COMPRESS');
        expect(getDecayLifecycleStateForSection(d.weak_threshold - 0.01, 250, d)).toBe('ARCHIVE');
      });
    }
  });
});

// ============================================================
// updateStabilityOnAccessForSection
// ============================================================

describe('updateStabilityOnAccessForSection', () => {
  describe('basic growth behavior', () => {
    it('increases stability on access', () => {
      const decay = SECTION_PROFILES.KNOWLEDGE.decay;
      const newStability = updateStabilityOnAccessForSection(10, 0.3, decay);
      expect(newStability).toBeGreaterThan(10);
    });

    it('caps at section max_stability_days', () => {
      const decay = SECTION_PROFILES.SIGNALS.decay;  // max_stability_days: 30
      const newStability = updateStabilityOnAccessForSection(25, 0.1, decay);
      expect(newStability).toBeLessThanOrEqual(30);
    });

    it('grows less with higher difficulty', () => {
      const decay = SECTION_PROFILES.KNOWLEDGE.decay;
      const lowDiff = updateStabilityOnAccessForSection(10, 0.1, decay);
      const highDiff = updateStabilityOnAccessForSection(10, 0.9, decay);
      expect(lowDiff).toBeGreaterThan(highDiff);
    });
  });

  describe('per-section growth rates', () => {
    it('PROCEDURAL grows fastest (3.5)', () => {
      const stability = 10;
      const difficulty = 0.3;
      const procedural = updateStabilityOnAccessForSection(stability, difficulty, SECTION_PROFILES.PROCEDURAL.decay);
      const knowledge = updateStabilityOnAccessForSection(stability, difficulty, SECTION_PROFILES.KNOWLEDGE.decay);
      const episodic = updateStabilityOnAccessForSection(stability, difficulty, SECTION_PROFILES.EPISODIC.decay);
      const signals = updateStabilityOnAccessForSection(stability, difficulty, SECTION_PROFILES.SIGNALS.decay);

      expect(procedural).toBeGreaterThan(knowledge);
      expect(knowledge).toBeGreaterThan(episodic);
      expect(episodic).toBeGreaterThan(signals);
    });

    it('SIGNALS growth is limited by max_stability_days: 30', () => {
      const signalDecay = SECTION_PROFILES.SIGNALS.decay;
      // Even with high base stability, cannot exceed 30 days
      const newStability = updateStabilityOnAccessForSection(20, 0.1, signalDecay);
      expect(newStability).toBeLessThanOrEqual(30);
    });

    it('KNOWLEDGE can reach 365 days', () => {
      const knowledgeDecay = SECTION_PROFILES.KNOWLEDGE.decay;
      // With high enough starting stability, can approach 365
      const newStability = updateStabilityOnAccessForSection(200, 0.1, knowledgeDecay);
      expect(newStability).toBeLessThanOrEqual(365);
      expect(newStability).toBeGreaterThan(200);
    });
  });

  describe('matches original function for global config', () => {
    // When given the global DECAY_CONFIG values, the section function
    // should produce the same result as the original
    const globalDecay: SectionDecayConfig = {
      initial_stability_days: 21,
      growth_rate: DECAY_CONFIG.growth_rate,         // 2.5
      active_threshold: DECAY_CONFIG.active_threshold, // 0.5
      weak_threshold: DECAY_CONFIG.weak_threshold,     // 0.1
      max_stability_days: DECAY_CONFIG.max_stability_days, // 365
    };

    it('produces identical results when using global params', () => {
      const original = updateStabilityOnAccess(10, 0.3);
      const section = updateStabilityOnAccessForSection(10, 0.3, globalDecay);
      expect(section).toBeCloseTo(original, 6);
    });
  });
});

// ============================================================
// getInitialStabilityForSubtype
// ============================================================

describe('getInitialStabilityForSubtype', () => {
  describe('per-subtype overrides', () => {
    it('signal: 2 days (fast decay)', () => {
      expect(getInitialStabilityForSubtype('custom:signal')).toBe(2);
    });

    it('lesson: 90 days (very durable)', () => {
      expect(getInitialStabilityForSubtype('custom:lesson')).toBe(90);
    });

    it('playbook: 180 days (nearly permanent)', () => {
      expect(getInitialStabilityForSubtype('custom:playbook')).toBe(180);
    });

    it('trade_entry: 21 days', () => {
      expect(getInitialStabilityForSubtype('custom:trade_entry')).toBe(21);
    });

    it('trade_close: 21 days', () => {
      expect(getInitialStabilityForSubtype('custom:trade_close')).toBe(21);
    });

    it('turn_summary: 7 days (fast decay)', () => {
      expect(getInitialStabilityForSubtype('custom:turn_summary')).toBe(7);
    });

    it('watchpoint: 5 days', () => {
      expect(getInitialStabilityForSubtype('custom:watchpoint')).toBe(5);
    });

    it('thesis: 30 days', () => {
      expect(getInitialStabilityForSubtype('custom:thesis')).toBe(30);
    });

    it('curiosity: 14 days', () => {
      expect(getInitialStabilityForSubtype('custom:curiosity')).toBe(14);
    });
  });

  describe('section fallbacks', () => {
    it('unknown subtype falls back to KNOWLEDGE default (60 days)', () => {
      expect(getInitialStabilityForSubtype('custom:future_type')).toBe(60);
    });

    it('null subtype falls back to KNOWLEDGE default (60 days)', () => {
      expect(getInitialStabilityForSubtype(null)).toBe(60);
    });

    it('undefined subtype falls back to KNOWLEDGE default (60 days)', () => {
      expect(getInitialStabilityForSubtype(undefined)).toBe(60);
    });
  });

  describe('ordering invariants', () => {
    it('signals decay fastest', () => {
      const signal = getInitialStabilityForSubtype('custom:signal');
      for (const subtype of Object.keys(SUBTYPE_INITIAL_STABILITY)) {
        if (subtype !== 'custom:signal') {
          expect(signal).toBeLessThanOrEqual(getInitialStabilityForSubtype(subtype));
        }
      }
    });

    it('playbooks are most durable', () => {
      const playbook = getInitialStabilityForSubtype('custom:playbook');
      for (const subtype of Object.keys(SUBTYPE_INITIAL_STABILITY)) {
        expect(playbook).toBeGreaterThanOrEqual(getInitialStabilityForSubtype(subtype));
      }
    });
  });
});

// ============================================================
// Integration: calculateRetrievability with section stability
// ============================================================

describe('FSRS decay with section-aware stability', () => {
  it('signal (2d stability) decays much faster than lesson (90d stability)', () => {
    const daysElapsed = 5;
    const signalR = calculateRetrievability(daysElapsed, 2);   // R = e^(-5/2) ≈ 0.082
    const lessonR = calculateRetrievability(daysElapsed, 90);  // R = e^(-5/90) ≈ 0.946

    expect(signalR).toBeLessThan(0.1);   // Signal nearly forgotten after 5 days
    expect(lessonR).toBeGreaterThan(0.9); // Lesson barely faded after 5 days
  });

  it('playbook (180d stability) barely decays after a month', () => {
    const daysElapsed = 30;
    const playbookR = calculateRetrievability(daysElapsed, 180); // R = e^(-30/180) ≈ 0.846
    expect(playbookR).toBeGreaterThan(0.8);
  });

  it('signal enters DORMANT lifecycle before lesson enters WEAK', () => {
    const signalDecay = SECTION_PROFILES.SIGNALS.decay;
    const knowledgeDecay = SECTION_PROFILES.KNOWLEDGE.decay;

    // After 7 days, signal (stability 2d) is nearly forgotten
    const signalR = calculateRetrievability(7, 2);   // R ≈ 0.030
    const signalState = getDecayLifecycleStateForSection(signalR, 7, signalDecay);

    // After 7 days, lesson (stability 90d) is barely faded
    const lessonR = calculateRetrievability(7, 90);   // R ≈ 0.925
    const lessonState = getDecayLifecycleStateForSection(lessonR, 0, knowledgeDecay);

    expect(signalState).toBe('DORMANT');  // Signal is dormant after a week
    expect(lessonState).toBe('ACTIVE');   // Lesson is still active after a week
  });

  it('signal cannot exceed 30-day stability even with repeated access', () => {
    const signalDecay = SECTION_PROFILES.SIGNALS.decay;
    let stability = 2;  // Start with initial signal stability

    // Simulate 10 recall events
    for (let i = 0; i < 10; i++) {
      stability = updateStabilityOnAccessForSection(stability, 0.2, signalDecay);
    }

    // Should be capped at 30 days regardless
    expect(stability).toBeLessThanOrEqual(30);
  });

  it('lesson grows to high stability with repeated access', () => {
    const knowledgeDecay = SECTION_PROFILES.KNOWLEDGE.decay;
    let stability = 90;  // Start with initial lesson stability

    // Simulate 3 recall events
    for (let i = 0; i < 3; i++) {
      stability = updateStabilityOnAccessForSection(stability, 0.4, knowledgeDecay);
    }

    // Should have grown significantly (but capped at 365)
    expect(stability).toBeGreaterThan(200);
    expect(stability).toBeLessThanOrEqual(365);
  });
});
```

**Run with:**
```bash
cd nous-server/core
npx vitest run src/params/section-decay.test.ts
```

**Expected:** All tests pass.

### Regression Tests (existing)

Run ALL existing tests to verify no regressions:

```bash
cd nous-server/core
npx vitest run
```

**Expected:**
- All existing params tests pass — the original `getDecayLifecycleState()`, `updateStabilityOnAccess()`, `getInitialStability()`, `getInitialDifficulty()` functions are UNCHANGED. The new functions are additions, not modifications.
- All existing SSA tests pass — `computeDecay()` signature is unchanged, only its internal behavior changed.
- All existing sections tests pass (from Guide 0)
- All section-reranking tests pass (from Guide 1, if implemented)

**Critical regression risk:** The `computeDecay()` function in `core-bridge.ts` is called by:
1. `applyDecay()` in core-bridge.ts — used by node GET, search response building
2. Decay route `POST /decay` — used by daemon batch decay

Both callers pass `NodeRow` objects which have `subtype`, so the section lookup will work. However, if there are any test fixtures that create mock `NodeRow` objects without `subtype`, `getSectionForSubtype(null)` returns `'KNOWLEDGE'` which uses `active_threshold: 0.4` and `weak_threshold: 0.05` — different from the global defaults. This could cause snapshot tests to produce different lifecycle states. Check for and update any such tests.

### Integration Tests (Live Local)

These tests require the Nous server running locally.

**Prerequisites:**
```bash
# Terminal 1: Build and start Nous
cd nous-server/core && npx tsup
cd ../server && pnpm dev
# Should show: "Nous server running on port 3100"
```

**Test 1: Verify signal nodes get correct initial stability (2 days)**
```bash
# Create a signal node
SIGNAL_ID=$(curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{"type": "concept", "subtype": "custom:signal", "content_title": "BTC funding spike", "content_body": "BTC funding rate at 0.15%"}' | jq -r '.id')

# Fetch the node and check initial stability
curl -s http://localhost:3100/v1/nodes/$SIGNAL_ID | jq '{neural_stability, neural_difficulty, memory_section}'
```

**Expected:**
```json
{
  "neural_stability": 2,
  "memory_section": "SIGNALS"
}
```

**Test 2: Verify lesson nodes get correct initial stability (90 days)**
```bash
LESSON_ID=$(curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{"type": "concept", "subtype": "custom:lesson", "content_title": "Funding squeeze pattern", "content_body": "When funding exceeds 0.10% and OI rising, short squeeze follows in 24h"}' | jq -r '.id')

curl -s http://localhost:3100/v1/nodes/$LESSON_ID | jq '{neural_stability, neural_difficulty, memory_section}'
```

**Expected:**
```json
{
  "neural_stability": 90,
  "memory_section": "KNOWLEDGE"
}
```

**Test 3: Verify playbook nodes get correct initial stability (180 days)**
```bash
PLAYBOOK_ID=$(curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{"type": "concept", "subtype": "custom:playbook", "content_title": "Funding squeeze short playbook", "content_body": "Short when funding > 0.10%, tight stop above range high, 2:1 R:R target"}' | jq -r '.id')

curl -s http://localhost:3100/v1/nodes/$PLAYBOOK_ID | jq '{neural_stability, neural_difficulty, memory_section}'
```

**Expected:**
```json
{
  "neural_stability": 180,
  "memory_section": "PROCEDURAL"
}
```

**Test 4: Verify stability growth is section-aware (access a signal, stability shouldn't exceed 30)**
```bash
# Access the signal node 3 times (each GET triggers stability growth)
for i in 1 2 3; do
  curl -s http://localhost:3100/v1/nodes/$SIGNAL_ID | jq '{neural_stability}' && sleep 1
done
```

**Expected:** Stability grows with each access but remains ≤ 30 (SIGNALS max_stability_days).

**Test 5: Verify decay cycle produces per-section lifecycle transitions**
```bash
# Backdate the signal node to 5 days ago (should be DORMANT with 2d stability)
curl -s -X PATCH "http://localhost:3100/v1/nodes/$SIGNAL_ID" \
  -H "Content-Type: application/json" \
  -d '{"neural_stability": 2, "neural_last_accessed": "2026-02-16T12:00:00Z"}'

# Run decay cycle
curl -s -X POST http://localhost:3100/v1/decay | jq '.'
```

**Expected:** The decay response shows the signal node transitioning from ACTIVE to a lower lifecycle state. The `subtype` field appears in transitions. The lesson node (if also present) should still be ACTIVE.

**Test 6: Verify all 16 subtypes get correct initial stability**
```bash
# Create one node of each subtype and check stability
for subtype in signal watchpoint lesson thesis curiosity playbook missed_opportunity good_pass trade_entry trade_close trade_modify trade turn_summary session_summary market_event; do
  ID=$(curl -s -X POST http://localhost:3100/v1/nodes \
    -H "Content-Type: application/json" \
    -d "{\"type\": \"concept\", \"subtype\": \"custom:$subtype\", \"content_title\": \"Test $subtype\", \"content_body\": \"Testing initial stability for $subtype\"}" | jq -r '.id')

  STABILITY=$(curl -s http://localhost:3100/v1/nodes/$ID | jq '.neural_stability')
  echo "$subtype: stability=$STABILITY"
done
```

**Expected output (all subtypes match SUBTYPE_INITIAL_STABILITY):**
```
signal: stability=2
watchpoint: stability=5
lesson: stability=90
thesis: stability=30
curiosity: stability=14
playbook: stability=180
missed_opportunity: stability=30
good_pass: stability=30
trade_entry: stability=21
trade_close: stability=21
trade_modify: stability=14
trade: stability=14
turn_summary: stability=7
session_summary: stability=14
market_event: stability=10
```

### Live Dynamic Tests (VPS)

After deploying the updated Nous server to VPS:

**Test 7: Verify newly created nodes on VPS get correct stability**
```bash
# SSH to VPS, then:
# Create a signal and a lesson, verify stability
SIGNAL_ID=$(curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{"type": "concept", "subtype": "custom:signal", "content_title": "VPS test signal", "content_body": "Testing section-aware stability"}' | jq -r '.id')

LESSON_ID=$(curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{"type": "concept", "subtype": "custom:lesson", "content_title": "VPS test lesson", "content_body": "Testing section-aware stability"}' | jq -r '.id')

echo "Signal stability:"
curl -s http://localhost:3100/v1/nodes/$SIGNAL_ID | jq '.neural_stability'
echo "Lesson stability:"
curl -s http://localhost:3100/v1/nodes/$LESSON_ID | jq '.neural_stability'
```

**Expected:** Signal = 2, Lesson = 90.

**Test 8: Verify decay cycle on VPS with existing nodes**
```bash
curl -s -X POST http://localhost:3100/v1/decay | jq '{processed, transitions_count, transitions: [.transitions[:5][] | {id, from, to, subtype}]}'
```

**Expected:** Transitions include `subtype` field. Signal nodes should transition faster than lesson/playbook nodes.

**Test 9: Verify existing nodes' lifecycle states are correct under new thresholds**
```bash
# Check a few existing nodes' lifecycle states
curl -s -X POST http://localhost:3100/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "trade", "limit": 10}' | jq '.data[] | {id, subtype, memory_section, state_lifecycle, neural_retrievability, neural_stability}'
```

**Expected:** KNOWLEDGE nodes (lessons) should be more likely to be ACTIVE at lower retrievability values compared to SIGNALS nodes. The `state_lifecycle` should reflect the per-section thresholds.

**Test 10: Full test suite on VPS**
```bash
cd nous-server/core
npx vitest run
```

**Expected:** All tests pass, including the new section-decay tests and all pre-existing tests.

---

## Verification Checklist

| # | Check | How to Verify |
|---|-------|---------------|
| 1 | TypeScript core compiles | `cd nous-server/core && npx tsup` — no errors |
| 2 | New section-decay tests pass | `npx vitest run src/params/section-decay.test.ts` — all green |
| 3 | Existing params tests still pass | `npx vitest run src/params/index.test.ts` — no regressions |
| 4 | Existing SSA tests still pass | `npx vitest run src/ssa/index.test.ts` — no regressions |
| 5 | Existing sections tests still pass | `npx vitest run src/sections/` — no regressions |
| 6 | Full test suite passes | `npx vitest run` — all tests pass |
| 7 | Signal initial stability = 2d | Create `custom:signal` node, GET it, verify `neural_stability: 2` |
| 8 | Lesson initial stability = 90d | Create `custom:lesson` node, GET it, verify `neural_stability: 90` |
| 9 | Playbook initial stability = 180d | Create `custom:playbook` node, GET it, verify `neural_stability: 180` |
| 10 | All 16 subtypes have correct stability | Run Test 6 script, verify all values match SUBTYPE_INITIAL_STABILITY |
| 11 | Signal stability caps at 30d | Access signal node repeatedly, verify stability ≤ 30 |
| 12 | Lesson stability grows to 365d max | Access lesson node, verify growth_rate is 3.0 (not 2.5) |
| 13 | Decay cycle uses per-section thresholds | Run decay, verify signals transition lifecycle faster than lessons |
| 14 | Decay response includes subtype | `POST /v1/decay` response transitions include `subtype` field |
| 15 | Dead branch fixed in new function | `getDecayLifecycleStateForSection(0.05, 90, knowledgeDecay)` returns 'COMPRESS' (not 'DORMANT') |
| 16 | No Python changes needed | Run Python tests: `PYTHONPATH=src python -m pytest tests/ -v` — no regressions |
| 17 | Backward compat: old functions unchanged | `getDecayLifecycleState(0.8, 0)` still returns 'ACTIVE' |
| 18 | VPS deploy + smoke test | Deploy, create signal + lesson, verify different stability values |

---

## File Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `nous-server/core/src/params/index.ts` | Modified | Add `getDecayLifecycleStateForSection()` and `updateStabilityOnAccessForSection()` functions (~50 lines). Add import for `SectionDecayConfig` from `@nous/core/sections`. |
| `nous-server/server/src/core-bridge.ts` | Modified | Update imports (+4 new). Modify `getNeuralDefaults()` to use `getInitialStabilityForSubtype()`. Modify `computeDecay()` to use per-section thresholds via `getDecayLifecycleStateForSection()`. Modify `computeStabilityGrowth()` to accept `subtype` and use `updateStabilityOnAccessForSection()`. (~30 lines changed) |
| `nous-server/server/src/routes/nodes.ts` | Modified | Pass `row.subtype` to `computeStabilityGrowth()` in GET handler (+1 line) |
| `nous-server/server/src/routes/decay.ts` | Modified | Add `subtype` to transitions type and log (+3 lines) |
| `nous-server/core/src/params/section-decay.test.ts` | **NEW** | Unit tests for per-section decay functions (~310 lines) |

**Total new code:** ~360 lines (functions + tests)
**Total modified:** ~35 lines across 4 existing files
**Schema changes:** None
**API changes:** `subtype` added to `POST /v1/decay` transition response (additive, non-breaking)
**Python changes:** None (all decay computations happen server-side in Nous TS)

---

## What Comes Next

After this guide is implemented:

- **Existing nodes** will naturally migrate to section-appropriate behavior as they are accessed (stability grows with section rate) and as decay cycles run (lifecycle transitions use section thresholds). No batch migration needed.
- **Issue 4** (Stakes Weighting) builds on the per-subtype initial stability from this guide by adding salience-based modulation — high-stakes events get multiplied initial stability within their section's range.
- **Issue 3** (Cross-Episode Generalization) depends on the per-section decay curves to make episodic memories decay appropriately — fast enough to motivate consolidation into durable knowledge.
- **The `SUBTYPE_TO_ALGO_TYPE` mapping in core-bridge.ts becomes largely vestigial** — it's still used for `getInitialDifficulty()` but no longer for initial stability. It can be cleaned up in a future revision if needed.
- **The dead branch fix in `getDecayLifecycleStateForSection()`** means nodes will correctly transition through DORMANT → COMPRESS → ARCHIVE. Previously the COMPRESS state was unreachable, meaning nodes jumped from DORMANT directly to ARCHIVE after `archive_days`.
