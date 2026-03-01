# Issue 0: Section Foundation — Implementation Guide

> **STATUS:** DONE (2026-02-21)
>
> **Depends on:** Nothing — this is the foundation all other issues build on.
>
> **What this creates:** The shared type definitions, subtype-to-section mapping, section profile configuration, and config infrastructure that Issues 1-6 all reference. After this guide is complete, the system knows which section every memory belongs to — but does not yet *use* that knowledge for retrieval, decay, or encoding. Those come in Issues 1-6.

---

## Problem Statement

The Hynous memory system has 15 custom subtypes (`custom:signal`, `custom:lesson`, `custom:trade_entry`, etc.) but no concept of "sections" — logical groupings that share retrieval weights, decay curves, and encoding rules. Before any issue can implement per-section behavior, the system needs:

1. **A section type definition** — What are the sections? (Episodic, Signals, Knowledge, Procedural)
2. **A subtype-to-section mapping** — Which subtypes belong to which section?
3. **Section profile structures** — What parameters does each section carry? (weight profiles, decay configs, encoding configs)
4. **Configuration infrastructure** — How are section parameters configured? (YAML-tunable, no code changes to adjust)
5. **Synchronization** — TypeScript (Nous runtime) and Python (agent/tools) must agree on all definitions.

Without this foundation, each issue would independently define its own section mapping, leading to inconsistencies and duplication.

---

## Required Reading

Read these files **in order** before implementing. The "Focus Areas" column tells you which parts matter — you do not need to memorize entire files.

### Core Memory Architecture (read first)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 1 | `revisions/memory-sections/executive-summary.md` | **START HERE.** Defines the 6 issues, 4 sections, design constraints, and brain analogy. | Full file — especially "Proposed Section Model" table (line ~410) and "Critical Design Principle" (line ~76) |
| 2 | `src/hynous/intelligence/tools/memory.py` | The `_TYPE_MAP` (lines 256-275) defines all 15 custom subtypes and their Nous types. This is the authoritative list of what needs to be mapped to sections. | Lines 256-275 (`_TYPE_MAP`) |
| 3 | `nous-server/server/src/core-bridge.ts` | The `SUBTYPE_TO_ALGO_TYPE` mapping (lines 25-40) is the current subtype→behavior dispatch. Section foundation replaces this pattern with a richer mapping. Also `getNeuralDefaults()` (lines 159-170) and `computeDecay()` (lines 106-123). | Lines 25-56 (type mappings), lines 106-170 (decay + defaults) |

### TypeScript Module Patterns (understand structure)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 4 | `nous-server/core/src/params/index.ts` | The canonical parameter module. Shows the pattern for defining typed constants with Zod validation. Houses `RerankingWeights` interface (lines 48-55), `RERANKING_WEIGHTS` (lines 72-79), `DECAY_CONFIG` (lines 214-224), `INITIAL_STABILITY` (lines 229-237). All of these will get per-section variants in Issues 1 and 2. | Lines 17-79 (RerankingWeights), lines 196-258 (DecayConfig + stability) |
| 5 | `nous-server/core/src/constants.ts` | Node types, subtypes, edge types, lifecycle states. Shows the pattern for defining enums/constants. | Scan for NODE_TYPES, CONCEPT_SUBTYPES, LIFECYCLE_STATES |
| 6 | `nous-server/core/src/index.ts` | Barrel re-exports for all modules. Shows how to add a new module export. | Lines 24-70 (export pattern) |
| 7 | `nous-server/core/tsup.config.ts` | Build configuration. New modules need entry points here to be importable as `@nous/core/sections`. | Full file (34 lines) |

### Python Config Patterns (understand structure)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 8 | `src/hynous/core/config.py` | All config dataclasses (`MemoryConfig`, `OrchestratorConfig`, `DaemonConfig`, `ScannerConfig`). Shows the pattern for adding new config sections. | Lines 56-136 (dataclass definitions), lines 240-280 (YAML loading) |
| 9 | `config/default.yaml` | All current configuration values. Shows the YAML structure for adding a new `sections:` block. | Full file (128 lines) |
| 10 | `src/hynous/nous/client.py` | The Python HTTP client for Nous. Shows how Python-side code interacts with Nous types. | Lines 56-83 (`create_node()` signature) |

### Existing Revision Patterns (understand guide conventions)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 11 | `revisions/MF0/implementation-guide.md` | Example of a foundation guide that other issues depend on. Shows the level of detail expected. | Skim structure and code block format |

---

## Architecture Decisions

### Decision 1: Sections are a static subtype → section lookup (FINAL)

Sections are NOT stored on nodes as a database column. Instead, section membership is determined at runtime by looking up the node's `subtype` in a static mapping. This means:

- **No database schema migration** — existing nodes are automatically classified
- **No API changes for node creation** — the `POST /v1/nodes` endpoint is unchanged
- **Instant reclassification** — if the mapping changes, all nodes are reclassified immediately
- **Both TypeScript and Python can independently classify** — they share the same mapping definition

**Where:** TypeScript defines `SUBTYPE_TO_SECTION` in `sections/index.ts`. Python mirrors it in `nous/sections.py`.

### Decision 2: Section profiles are defined in TypeScript, config-overridable from Python (FINAL)

TypeScript (`@nous/core`) defines the **default** section profiles (weight profiles, decay configs). These are compile-time constants used by SSA, decay, and node creation.

Python config (`default.yaml`) can override specific parameters for tuning without rebuilding Nous. The Python-side `sections.py` module loads these overrides and passes them to Nous where applicable (e.g., as API parameters).

**Rationale:** The TypeScript core is the authoritative runtime. But YAML overrides allow tuning section parameters without rebuilding/redeploying Nous.

### Decision 3: Four sections, no more (FINAL)

| Section | Subtypes | Character |
|---------|----------|-----------|
| **EPISODIC** | `trade_entry`, `trade_close`, `trade_modify`, `turn_summary`, `session_summary`, `market_event` | What happened. Fast-write, medium-decay. |
| **SIGNALS** | `signal`, `watchpoint` | What to watch. Fastest decay, recency-dominant. |
| **KNOWLEDGE** | `lesson`, `thesis`, `curiosity` | What I've learned. Slow decay, authority-dominant. |
| **PROCEDURAL** | `playbook`, `missed_opportunity`, `good_pass` | How to act. Pattern-match retrieval, extremely durable. |

**Unmapped subtypes:** `trade` (legacy, rarely used) maps to EPISODIC. Any future custom subtypes default to KNOWLEDGE.

### Decision 4: Python is the source of truth for tunable config, TypeScript for runtime constants (FINAL)

- `default.yaml` → Python `SectionsConfig` → passed to Nous API calls where applicable
- `@nous/core/sections` → TypeScript `SECTION_PROFILES` → used directly in SSA/decay/creation

When both exist, the Python YAML override takes precedence (it's the outer layer). TypeScript constants are the fallback defaults.

---

## Implementation Steps

### Step 0.1: Create the TypeScript sections module

**New file:** `nous-server/core/src/sections/index.ts`

This file defines the section enum, the subtype-to-section mapping, section profile types, and default profiles.

```typescript
/**
 * @module @nous/core/sections
 * @description Memory section definitions — the bias layer that gives different
 * memory types different retrieval weights, decay curves, and encoding rules.
 *
 * Sections are a STATIC LOOKUP based on node subtype, not a stored field.
 * All nodes remain in one table. All queries still search all nodes.
 * Sections influence HOW results are scored, not WHICH results appear.
 *
 * See: revisions/memory-sections/executive-summary.md
 */

import { z } from 'zod';
import type { RerankingWeights } from '../params/index.js';

// ============================================================
// SECTION ENUM
// ============================================================

/**
 * The four memory sections, inspired by brain regions.
 *
 * EPISODIC  (Hippocampus)  — What happened: trades, summaries, events
 * SIGNALS   (Sensory cortex) — What to watch: signals, watchpoints
 * KNOWLEDGE (Neocortex)    — What I've learned: lessons, theses, curiosity
 * PROCEDURAL (Cerebellum)  — How to act: playbooks, outcome analysis
 */
export const MEMORY_SECTIONS = ['EPISODIC', 'SIGNALS', 'KNOWLEDGE', 'PROCEDURAL'] as const;
export type MemorySection = (typeof MEMORY_SECTIONS)[number];

// ============================================================
// SUBTYPE → SECTION MAPPING
// ============================================================

/**
 * Static mapping from custom subtype to memory section.
 *
 * This is the SINGLE SOURCE OF TRUTH for section membership.
 * Both TypeScript runtime and Python config mirror this mapping.
 *
 * If a subtype is not in this map, it defaults to KNOWLEDGE.
 */
export const SUBTYPE_TO_SECTION: Record<string, MemorySection> = {
  // EPISODIC — What happened
  'custom:trade_entry': 'EPISODIC',
  'custom:trade_close': 'EPISODIC',
  'custom:trade_modify': 'EPISODIC',
  'custom:trade': 'EPISODIC',          // Legacy subtype, rarely used
  'custom:turn_summary': 'EPISODIC',
  'custom:session_summary': 'EPISODIC',
  'custom:market_event': 'EPISODIC',

  // SIGNALS — What to watch
  'custom:signal': 'SIGNALS',
  'custom:watchpoint': 'SIGNALS',

  // KNOWLEDGE — What I've learned
  'custom:lesson': 'KNOWLEDGE',
  'custom:thesis': 'KNOWLEDGE',
  'custom:curiosity': 'KNOWLEDGE',

  // PROCEDURAL — How to act
  'custom:playbook': 'PROCEDURAL',
  'custom:missed_opportunity': 'PROCEDURAL',
  'custom:good_pass': 'PROCEDURAL',
};

/**
 * Get the memory section for a node's subtype.
 * Returns KNOWLEDGE as default for unknown subtypes.
 */
export function getSectionForSubtype(subtype: string | null | undefined): MemorySection {
  if (!subtype) return 'KNOWLEDGE';
  return SUBTYPE_TO_SECTION[subtype] ?? 'KNOWLEDGE';
}

// ============================================================
// SECTION PROFILE TYPES
// ============================================================

/**
 * Decay configuration per section.
 * Controls how fast memories in this section fade and transition lifecycle states.
 */
export interface SectionDecayConfig {
  /** Initial stability in days for new nodes (before any access-based growth) */
  initial_stability_days: number;
  /** Multiplier applied to stability on each recall (FSRS growth) */
  growth_rate: number;
  /** Retrievability above this = ACTIVE */
  active_threshold: number;
  /** Retrievability above this = WEAK (below = DORMANT) */
  weak_threshold: number;
  /** Maximum stability in days (cap) */
  max_stability_days: number;
}

/**
 * Encoding configuration per section.
 * Controls how strongly new memories encode based on stakes/salience.
 */
export interface SectionEncodingConfig {
  /** Base difficulty for FSRS (0-1, higher = harder to recall = decays faster) */
  base_difficulty: number;
  /** Whether this section supports salience modulation (Issue 4) */
  salience_enabled: boolean;
  /** Maximum stability multiplier from salience (e.g., 2.0 = up to 2x base) */
  max_salience_multiplier: number;
}

/**
 * Complete section profile — all parameters that define a section's behavior.
 */
export interface SectionProfile {
  /** Human-readable section name */
  name: string;
  /** Section identifier */
  section: MemorySection;
  /** Per-section reranking weights for SSA (Issue 1) */
  reranking_weights: RerankingWeights;
  /** Per-section FSRS decay configuration (Issue 2) */
  decay: SectionDecayConfig;
  /** Per-section encoding configuration (Issue 4) */
  encoding: SectionEncodingConfig;
  /** Role in consolidation pipeline: 'source', 'target', or 'both' (Issue 3) */
  consolidation_role: 'source' | 'target' | 'both' | 'none';
  /** Intent boost multiplier when this section matches query intent (Issue 6) */
  intent_boost: number;
}

// ============================================================
// DEFAULT SECTION PROFILES
// ============================================================

/**
 * Default section profiles.
 *
 * These are the COMPILE-TIME DEFAULTS used by @nous/core.
 * Python-side YAML config can override individual parameters.
 *
 * Weight values are placeholders in this foundation guide.
 * Issues 1, 2, 4, and 6 will finalize the exact values.
 * The STRUCTURE is what matters here — the values will be tuned.
 */
export const SECTION_PROFILES: Record<MemorySection, SectionProfile> = {
  EPISODIC: {
    name: 'Episodic',
    section: 'EPISODIC',
    reranking_weights: {
      semantic: 0.20,
      keyword: 0.15,
      graph: 0.15,
      recency: 0.30,
      authority: 0.10,
      affinity: 0.10,
    },
    decay: {
      initial_stability_days: 14,
      growth_rate: 2.0,
      active_threshold: 0.5,
      weak_threshold: 0.1,
      max_stability_days: 180,
    },
    encoding: {
      base_difficulty: 0.3,
      salience_enabled: true,
      max_salience_multiplier: 2.0,
    },
    consolidation_role: 'source',
    intent_boost: 1.3,
  },

  SIGNALS: {
    name: 'Signals',
    section: 'SIGNALS',
    reranking_weights: {
      semantic: 0.15,
      keyword: 0.10,
      graph: 0.10,
      recency: 0.45,
      authority: 0.10,
      affinity: 0.10,
    },
    decay: {
      initial_stability_days: 2,
      growth_rate: 1.5,
      active_threshold: 0.5,
      weak_threshold: 0.15,
      max_stability_days: 30,
    },
    encoding: {
      base_difficulty: 0.2,
      salience_enabled: false,
      max_salience_multiplier: 1.0,
    },
    consolidation_role: 'source',
    intent_boost: 1.3,
  },

  KNOWLEDGE: {
    name: 'Knowledge',
    section: 'KNOWLEDGE',
    reranking_weights: {
      semantic: 0.35,
      keyword: 0.15,
      graph: 0.20,
      recency: 0.05,
      authority: 0.20,
      affinity: 0.05,
    },
    decay: {
      initial_stability_days: 60,
      growth_rate: 3.0,
      active_threshold: 0.4,
      weak_threshold: 0.05,
      max_stability_days: 365,
    },
    encoding: {
      base_difficulty: 0.4,
      salience_enabled: true,
      max_salience_multiplier: 2.0,
    },
    consolidation_role: 'target',
    intent_boost: 1.3,
  },

  PROCEDURAL: {
    name: 'Procedural',
    section: 'PROCEDURAL',
    reranking_weights: {
      semantic: 0.25,
      keyword: 0.25,
      graph: 0.20,
      recency: 0.05,
      authority: 0.15,
      affinity: 0.10,
    },
    decay: {
      initial_stability_days: 120,
      growth_rate: 3.5,
      active_threshold: 0.3,
      weak_threshold: 0.03,
      max_stability_days: 365,
    },
    encoding: {
      base_difficulty: 0.5,
      salience_enabled: true,
      max_salience_multiplier: 3.0,
    },
    consolidation_role: 'target',
    intent_boost: 1.3,
  },
};

// ============================================================
// ZOD VALIDATION
// ============================================================

export const SectionDecayConfigSchema = z.object({
  initial_stability_days: z.number().positive(),
  growth_rate: z.number().positive(),
  active_threshold: z.number().min(0).max(1),
  weak_threshold: z.number().min(0).max(1),
  max_stability_days: z.number().positive(),
});

export const SectionEncodingConfigSchema = z.object({
  base_difficulty: z.number().min(0).max(1),
  salience_enabled: z.boolean(),
  max_salience_multiplier: z.number().min(1),
});

export const RerankingWeightsSchema = z.object({
  semantic: z.number().min(0).max(1),
  keyword: z.number().min(0).max(1),
  graph: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  affinity: z.number().min(0).max(1),
}).refine(
  (w) => Math.abs(w.semantic + w.keyword + w.graph + w.recency + w.authority + w.affinity - 1.0) < 0.01,
  { message: 'Reranking weights must sum to 1.0' }
);

/**
 * Validate all section profiles at import time.
 * Throws if any profile has invalid parameters.
 */
export function validateSectionProfiles(): void {
  for (const [section, profile] of Object.entries(SECTION_PROFILES)) {
    SectionDecayConfigSchema.parse(profile.decay);
    SectionEncodingConfigSchema.parse(profile.encoding);
    RerankingWeightsSchema.parse(profile.reranking_weights);
    if (profile.decay.weak_threshold >= profile.decay.active_threshold) {
      throw new Error(`Section ${section}: weak_threshold must be < active_threshold`);
    }
  }
}

// Run validation on module load (fail fast if profiles are invalid)
validateSectionProfiles();

// ============================================================
// PER-SUBTYPE INITIAL STABILITY OVERRIDES
// ============================================================

/**
 * Per-subtype initial stability overrides (in days).
 * These take priority over section defaults for specific subtypes
 * that need different stability within their section.
 *
 * Example: trade_entry (21d) vs turn_summary (7d) — both EPISODIC
 * but trade records should persist longer than conversation summaries.
 */
export const SUBTYPE_INITIAL_STABILITY: Record<string, number> = {
  // EPISODIC section (default: 14 days)
  'custom:trade_entry': 21,       // Trade records should persist
  'custom:trade_close': 21,       // Outcomes are valuable
  'custom:trade_modify': 14,      // Position adjustments — section default
  'custom:trade': 14,             // Legacy — section default
  'custom:turn_summary': 7,       // Compressed exchanges — fast decay
  'custom:session_summary': 14,   // Session digests — section default
  'custom:market_event': 10,      // External events — medium

  // SIGNALS section (default: 2 days)
  'custom:signal': 2,             // Market signals — very fast decay
  'custom:watchpoint': 5,         // Watchpoints persist slightly longer (user-set)

  // KNOWLEDGE section (default: 60 days)
  'custom:lesson': 90,            // Hard-won lessons — very durable
  'custom:thesis': 30,            // Theses have time-bound validity
  'custom:curiosity': 14,         // Curiosity items are exploratory

  // PROCEDURAL section (default: 120 days)
  'custom:playbook': 180,         // Validated playbooks — nearly permanent
  'custom:missed_opportunity': 30, // Regret items — medium persistence
  'custom:good_pass': 30,         // Good passes — medium persistence
};

/**
 * Get initial stability for a specific subtype.
 * Falls back to section default, then to 21 days (global fallback).
 */
export function getInitialStabilityForSubtype(subtype: string | null | undefined): number {
  if (subtype && subtype in SUBTYPE_INITIAL_STABILITY) {
    return SUBTYPE_INITIAL_STABILITY[subtype]!;
  }
  const section = getSectionForSubtype(subtype);
  return SECTION_PROFILES[section].decay.initial_stability_days;
}
```

---

### Step 0.2: Register the sections module in tsup build config

**File:** `nous-server/core/tsup.config.ts`

**Find this** (line 26):
```typescript
    'src/agent/index.ts',
  ],
```

**Replace with:**
```typescript
    'src/agent/index.ts',
    'src/sections/index.ts',
  ],
```

**Why:** This makes the sections module importable as `@nous/core/sections` in the server code. Without this entry point, the module would only be accessible through the barrel `@nous/core` import.

---

### Step 0.3: Export sections from the core barrel

**File:** `nous-server/core/src/index.ts`

**Find this** (around line 189):
```typescript
export * from './context-window';
```

**Insert after:**
```typescript

// Re-export memory sections module (memory-sections revision)
export * from './sections';
```

**Why:** Allows `import { getSectionForSubtype } from '@nous/core'` as an alternative to the direct `@nous/core/sections` import.

---

### Step 0.4: Wire sections into core-bridge.ts

**File:** `nous-server/server/src/core-bridge.ts`

This step adds section information to node responses so the Python side can see which section a node belongs to. It does NOT yet change decay or reranking behavior — those come in Issues 1 and 2.

**Find this** (line 9-20, the imports):
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
```

**Replace with:**
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

**Find this** (the `applyDecay` function, lines 129-139):
```typescript
export function applyDecay<T extends NodeRow>(row: T): T & {
  neural_retrievability: number;
  state_lifecycle: string;
} {
  const { retrievability, lifecycle_state } = computeDecay(row);
  return {
    ...row,
    neural_retrievability: Math.round(retrievability * 10000) / 10000,
    state_lifecycle: lifecycle_state,
  };
}
```

**Replace with:**
```typescript
export function applyDecay<T extends NodeRow>(row: T): T & {
  neural_retrievability: number;
  state_lifecycle: string;
  memory_section: MemorySection;
} {
  const { retrievability, lifecycle_state } = computeDecay(row);
  return {
    ...row,
    neural_retrievability: Math.round(retrievability * 10000) / 10000,
    state_lifecycle: lifecycle_state,
    memory_section: getSectionForSubtype(row.subtype),
  };
}
```

**Why:** Every node response now includes `memory_section: "EPISODIC" | "SIGNALS" | "KNOWLEDGE" | "PROCEDURAL"`. This is a read-only computed field (not stored in DB). The Python side will see it in search results and can use it for section-aware formatting, intent boost, etc.

---

### Step 0.5: Create the Python sections module

**New file:** `src/hynous/nous/sections.py`

This is the Python-side mirror of the TypeScript sections definitions. It must stay in sync with `nous-server/core/src/sections/index.ts`.

```python
"""
Memory Sections — Python-side section definitions.

Mirrors the TypeScript module @nous/core/sections.
Sections are a BIAS LAYER on top of existing SSA search:
- All nodes stay in one table
- All queries still search all nodes
- Sections influence HOW results are scored (reranking weights),
  how fast they decay (FSRS params), and how strongly they encode (salience)

See: revisions/memory-sections/executive-summary.md

IMPORTANT: This file must stay in sync with:
  nous-server/core/src/sections/index.ts
"""

from __future__ import annotations

from enum import Enum
from dataclasses import dataclass, field
from typing import Optional


# ============================================================
# SECTION ENUM
# ============================================================

class MemorySection(str, Enum):
    """The four memory sections, inspired by brain regions."""
    EPISODIC = "EPISODIC"       # Hippocampus — what happened
    SIGNALS = "SIGNALS"         # Sensory cortex — what to watch
    KNOWLEDGE = "KNOWLEDGE"     # Neocortex — what I've learned
    PROCEDURAL = "PROCEDURAL"   # Cerebellum — how to act


# ============================================================
# SUBTYPE → SECTION MAPPING
# ============================================================

# SINGLE SOURCE OF TRUTH (Python side).
# Must match SUBTYPE_TO_SECTION in nous-server/core/src/sections/index.ts
SUBTYPE_TO_SECTION: dict[str, MemorySection] = {
    # EPISODIC — What happened
    "custom:trade_entry": MemorySection.EPISODIC,
    "custom:trade_close": MemorySection.EPISODIC,
    "custom:trade_modify": MemorySection.EPISODIC,
    "custom:trade": MemorySection.EPISODIC,
    "custom:turn_summary": MemorySection.EPISODIC,
    "custom:session_summary": MemorySection.EPISODIC,
    "custom:market_event": MemorySection.EPISODIC,

    # SIGNALS — What to watch
    "custom:signal": MemorySection.SIGNALS,
    "custom:watchpoint": MemorySection.SIGNALS,

    # KNOWLEDGE — What I've learned
    "custom:lesson": MemorySection.KNOWLEDGE,
    "custom:thesis": MemorySection.KNOWLEDGE,
    "custom:curiosity": MemorySection.KNOWLEDGE,

    # PROCEDURAL — How to act
    "custom:playbook": MemorySection.PROCEDURAL,
    "custom:missed_opportunity": MemorySection.PROCEDURAL,
    "custom:good_pass": MemorySection.PROCEDURAL,
}

# Reverse map: memory_type (agent-facing name) → section
# Uses the keys from tools/memory.py _TYPE_MAP
MEMORY_TYPE_TO_SECTION: dict[str, MemorySection] = {
    "trade_entry": MemorySection.EPISODIC,
    "trade_close": MemorySection.EPISODIC,
    "trade_modify": MemorySection.EPISODIC,
    "trade": MemorySection.EPISODIC,
    "turn_summary": MemorySection.EPISODIC,
    "session_summary": MemorySection.EPISODIC,
    "episode": MemorySection.EPISODIC,      # maps to custom:market_event

    "signal": MemorySection.SIGNALS,
    "watchpoint": MemorySection.SIGNALS,

    "lesson": MemorySection.KNOWLEDGE,
    "thesis": MemorySection.KNOWLEDGE,
    "curiosity": MemorySection.KNOWLEDGE,

    "playbook": MemorySection.PROCEDURAL,
    "missed_opportunity": MemorySection.PROCEDURAL,
    "good_pass": MemorySection.PROCEDURAL,
}

DEFAULT_SECTION = MemorySection.KNOWLEDGE


def get_section_for_subtype(subtype: str | None) -> MemorySection:
    """Get the memory section for a node's subtype.

    Returns KNOWLEDGE as default for unknown subtypes.
    """
    if not subtype:
        return DEFAULT_SECTION
    return SUBTYPE_TO_SECTION.get(subtype, DEFAULT_SECTION)


def get_section_for_memory_type(memory_type: str) -> MemorySection:
    """Get the memory section for an agent-facing memory type name.

    Uses the same keys as _TYPE_MAP in tools/memory.py.
    Returns KNOWLEDGE as default for unknown types.
    """
    return MEMORY_TYPE_TO_SECTION.get(memory_type, DEFAULT_SECTION)


# ============================================================
# SECTION PROFILE DATACLASSES
# ============================================================

@dataclass(frozen=True)
class SectionDecayConfig:
    """Decay configuration per section."""
    initial_stability_days: float = 21.0
    growth_rate: float = 2.5
    active_threshold: float = 0.5
    weak_threshold: float = 0.1
    max_stability_days: float = 365.0


@dataclass(frozen=True)
class SectionEncodingConfig:
    """Encoding configuration per section."""
    base_difficulty: float = 0.3
    salience_enabled: bool = False
    max_salience_multiplier: float = 1.0


@dataclass(frozen=True)
class RerankingWeights:
    """6-signal reranking weight profile. Must sum to 1.0."""
    semantic: float = 0.30
    keyword: float = 0.15
    graph: float = 0.20
    recency: float = 0.15
    authority: float = 0.10
    affinity: float = 0.10

    def __post_init__(self):
        total = (self.semantic + self.keyword + self.graph +
                 self.recency + self.authority + self.affinity)
        if abs(total - 1.0) > 0.01:
            raise ValueError(
                f"Reranking weights must sum to 1.0, got {total:.3f}"
            )


@dataclass(frozen=True)
class SectionProfile:
    """Complete section profile — all parameters for one section."""
    name: str
    section: MemorySection
    reranking_weights: RerankingWeights
    decay: SectionDecayConfig
    encoding: SectionEncodingConfig
    consolidation_role: str = "none"   # 'source', 'target', 'both', 'none'
    intent_boost: float = 1.3          # Multiplier when section matches query intent


# ============================================================
# DEFAULT SECTION PROFILES
# ============================================================

# These mirror SECTION_PROFILES in nous-server/core/src/sections/index.ts.
# Values are placeholders — Issues 1, 2, 4, 6 finalize exact tuning.

SECTION_PROFILES: dict[MemorySection, SectionProfile] = {
    MemorySection.EPISODIC: SectionProfile(
        name="Episodic",
        section=MemorySection.EPISODIC,
        reranking_weights=RerankingWeights(
            semantic=0.20, keyword=0.15, graph=0.15,
            recency=0.30, authority=0.10, affinity=0.10,
        ),
        decay=SectionDecayConfig(
            initial_stability_days=14, growth_rate=2.0,
            active_threshold=0.5, weak_threshold=0.1,
            max_stability_days=180,
        ),
        encoding=SectionEncodingConfig(
            base_difficulty=0.3, salience_enabled=True,
            max_salience_multiplier=2.0,
        ),
        consolidation_role="source",
        intent_boost=1.3,
    ),

    MemorySection.SIGNALS: SectionProfile(
        name="Signals",
        section=MemorySection.SIGNALS,
        reranking_weights=RerankingWeights(
            semantic=0.15, keyword=0.10, graph=0.10,
            recency=0.45, authority=0.10, affinity=0.10,
        ),
        decay=SectionDecayConfig(
            initial_stability_days=2, growth_rate=1.5,
            active_threshold=0.5, weak_threshold=0.15,
            max_stability_days=30,
        ),
        encoding=SectionEncodingConfig(
            base_difficulty=0.2, salience_enabled=False,
            max_salience_multiplier=1.0,
        ),
        consolidation_role="source",
        intent_boost=1.3,
    ),

    MemorySection.KNOWLEDGE: SectionProfile(
        name="Knowledge",
        section=MemorySection.KNOWLEDGE,
        reranking_weights=RerankingWeights(
            semantic=0.35, keyword=0.15, graph=0.20,
            recency=0.05, authority=0.20, affinity=0.05,
        ),
        decay=SectionDecayConfig(
            initial_stability_days=60, growth_rate=3.0,
            active_threshold=0.4, weak_threshold=0.05,
            max_stability_days=365,
        ),
        encoding=SectionEncodingConfig(
            base_difficulty=0.4, salience_enabled=True,
            max_salience_multiplier=2.0,
        ),
        consolidation_role="target",
        intent_boost=1.3,
    ),

    MemorySection.PROCEDURAL: SectionProfile(
        name="Procedural",
        section=MemorySection.PROCEDURAL,
        reranking_weights=RerankingWeights(
            semantic=0.25, keyword=0.25, graph=0.20,
            recency=0.05, authority=0.15, affinity=0.10,
        ),
        decay=SectionDecayConfig(
            initial_stability_days=120, growth_rate=3.5,
            active_threshold=0.3, weak_threshold=0.03,
            max_stability_days=365,
        ),
        encoding=SectionEncodingConfig(
            base_difficulty=0.5, salience_enabled=True,
            max_salience_multiplier=3.0,
        ),
        consolidation_role="target",
        intent_boost=1.3,
    ),
}


def get_section_profile(section: MemorySection) -> SectionProfile:
    """Get the full profile for a section."""
    return SECTION_PROFILES[section]


def get_profile_for_subtype(subtype: str | None) -> SectionProfile:
    """Get the section profile for a specific node subtype."""
    section = get_section_for_subtype(subtype)
    return SECTION_PROFILES[section]


# ============================================================
# PER-SUBTYPE INITIAL STABILITY OVERRIDES
# ============================================================

# Per-subtype overrides for initial stability (in days).
# Takes priority over section defaults.
# Must match SUBTYPE_INITIAL_STABILITY in nous-server/core/src/sections/index.ts.
SUBTYPE_INITIAL_STABILITY: dict[str, float] = {
    # EPISODIC (section default: 14 days)
    "custom:trade_entry": 21,
    "custom:trade_close": 21,
    "custom:trade_modify": 14,
    "custom:trade": 14,
    "custom:turn_summary": 7,
    "custom:session_summary": 14,
    "custom:market_event": 10,

    # SIGNALS (section default: 2 days)
    "custom:signal": 2,
    "custom:watchpoint": 5,

    # KNOWLEDGE (section default: 60 days)
    "custom:lesson": 90,
    "custom:thesis": 30,
    "custom:curiosity": 14,

    # PROCEDURAL (section default: 120 days)
    "custom:playbook": 180,
    "custom:missed_opportunity": 30,
    "custom:good_pass": 30,
}


def get_initial_stability_for_subtype(subtype: str | None) -> float:
    """Get initial stability for a specific subtype (in days).

    Falls back to section default, then to 21 days (global fallback).
    """
    if subtype and subtype in SUBTYPE_INITIAL_STABILITY:
        return SUBTYPE_INITIAL_STABILITY[subtype]
    section = get_section_for_subtype(subtype)
    return SECTION_PROFILES[section].decay.initial_stability_days
```

---

### Step 0.6: Add SectionsConfig to Python config

**File:** `src/hynous/core/config.py`

**Find this** (after the `OrchestratorConfig` dataclass, around line 78):
```python
@dataclass
class DaemonConfig:
```

**Insert BEFORE the DaemonConfig class:**
```python
@dataclass
class SectionsConfig:
    """Memory sections — brain-inspired bias layer on retrieval and decay.

    Sections are determined by subtype → section mapping (static lookup).
    These settings control the behavior overlay.
    See: revisions/memory-sections/executive-summary.md
    """
    enabled: bool = True                    # Master switch for section-aware behavior
    intent_boost: float = 1.3              # Score multiplier for query-relevant sections
    default_section: str = "KNOWLEDGE"     # Fallback section for unknown subtypes


```

**Then**, in the `load_config()` function, find where config sections are loaded from YAML (around line 240-280). Find the pattern used for other configs (e.g., `orchestrator_raw = raw.get("orchestrator", {})`) and add:

**Find this** (around the config loading section):
```python
    orch_raw = raw.get("orchestrator", {})
```

**Insert after** (on a new line):
```python
    sections_raw = raw.get("sections", {})
```

**Then**, in the `Config` constructor call, find where `orchestrator=OrchestratorConfig(...)` is built, and add the sections config next to it. Add this field to the Config dataclass:

**Find the Config dataclass definition** and add `sections: SectionsConfig` as a field. Then in the `load_config()` return, add:
```python
    sections=SectionsConfig(
        enabled=sections_raw.get("enabled", True),
        intent_boost=sections_raw.get("intent_boost", 1.3),
        default_section=sections_raw.get("default_section", "KNOWLEDGE"),
    ),
```

---

### Step 0.7: Add sections config to default.yaml

**File:** `config/default.yaml`

**Find this** (around line 113-114):
```yaml
  compress_enabled: true         # Enable/disable automatic compression
```

**Insert after** (on a new line, as a top-level section):
```yaml

# Memory sections — brain-inspired bias layer
# Sections give different memory types different retrieval weights, decay curves,
# and encoding rules. All nodes stay in one table; sections are a reranking bias.
# See: revisions/memory-sections/executive-summary.md
sections:
  enabled: true                    # Master switch for section-aware behavior
  intent_boost: 1.3               # Score multiplier for query-relevant sections (Issue 6)
  default_section: "KNOWLEDGE"    # Fallback section for unknown subtypes
```

---

### Step 0.8: Build and verify TypeScript module

After creating the TypeScript sections module, it must be compiled.

**Commands to run (from project root):**
```bash
cd nous-server/core
npx tsup
```

**Expected output:** Build succeeds with no errors. The `dist/sections/` directory should exist with `index.js` and `index.d.ts`.

**Verify the module is importable:**
```bash
cd nous-server/server
node -e "const s = await import('@nous/core/sections'); console.log(s.MEMORY_SECTIONS); console.log(s.getSectionForSubtype('custom:lesson'));"
```

**Expected output:**
```
[ 'EPISODIC', 'SIGNALS', 'KNOWLEDGE', 'PROCEDURAL' ]
KNOWLEDGE
```

---

## Testing

### Unit Tests (TypeScript)

**New file:** `nous-server/core/src/sections/__tests__/sections.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  MEMORY_SECTIONS,
  SUBTYPE_TO_SECTION,
  SECTION_PROFILES,
  SUBTYPE_INITIAL_STABILITY,
  getSectionForSubtype,
  getInitialStabilityForSubtype,
  validateSectionProfiles,
} from '../index.js';

describe('sections', () => {
  describe('MEMORY_SECTIONS', () => {
    it('has exactly 4 sections', () => {
      expect(MEMORY_SECTIONS).toHaveLength(4);
    });

    it('contains EPISODIC, SIGNALS, KNOWLEDGE, PROCEDURAL', () => {
      expect(MEMORY_SECTIONS).toContain('EPISODIC');
      expect(MEMORY_SECTIONS).toContain('SIGNALS');
      expect(MEMORY_SECTIONS).toContain('KNOWLEDGE');
      expect(MEMORY_SECTIONS).toContain('PROCEDURAL');
    });
  });

  describe('SUBTYPE_TO_SECTION', () => {
    it('maps all 16 custom subtypes', () => {
      expect(Object.keys(SUBTYPE_TO_SECTION)).toHaveLength(16);
    });

    it('maps trade subtypes to EPISODIC', () => {
      expect(SUBTYPE_TO_SECTION['custom:trade_entry']).toBe('EPISODIC');
      expect(SUBTYPE_TO_SECTION['custom:trade_close']).toBe('EPISODIC');
      expect(SUBTYPE_TO_SECTION['custom:trade_modify']).toBe('EPISODIC');
      expect(SUBTYPE_TO_SECTION['custom:trade']).toBe('EPISODIC');
      expect(SUBTYPE_TO_SECTION['custom:turn_summary']).toBe('EPISODIC');
      expect(SUBTYPE_TO_SECTION['custom:session_summary']).toBe('EPISODIC');
      expect(SUBTYPE_TO_SECTION['custom:market_event']).toBe('EPISODIC');
    });

    it('maps signal subtypes to SIGNALS', () => {
      expect(SUBTYPE_TO_SECTION['custom:signal']).toBe('SIGNALS');
      expect(SUBTYPE_TO_SECTION['custom:watchpoint']).toBe('SIGNALS');
    });

    it('maps knowledge subtypes to KNOWLEDGE', () => {
      expect(SUBTYPE_TO_SECTION['custom:lesson']).toBe('KNOWLEDGE');
      expect(SUBTYPE_TO_SECTION['custom:thesis']).toBe('KNOWLEDGE');
      expect(SUBTYPE_TO_SECTION['custom:curiosity']).toBe('KNOWLEDGE');
    });

    it('maps procedural subtypes to PROCEDURAL', () => {
      expect(SUBTYPE_TO_SECTION['custom:playbook']).toBe('PROCEDURAL');
      expect(SUBTYPE_TO_SECTION['custom:missed_opportunity']).toBe('PROCEDURAL');
      expect(SUBTYPE_TO_SECTION['custom:good_pass']).toBe('PROCEDURAL');
    });
  });

  describe('getSectionForSubtype', () => {
    it('returns correct section for known subtypes', () => {
      expect(getSectionForSubtype('custom:signal')).toBe('SIGNALS');
      expect(getSectionForSubtype('custom:lesson')).toBe('KNOWLEDGE');
      expect(getSectionForSubtype('custom:trade_entry')).toBe('EPISODIC');
      expect(getSectionForSubtype('custom:playbook')).toBe('PROCEDURAL');
    });

    it('returns KNOWLEDGE for unknown subtypes', () => {
      expect(getSectionForSubtype('custom:unknown')).toBe('KNOWLEDGE');
      expect(getSectionForSubtype('anything')).toBe('KNOWLEDGE');
    });

    it('returns KNOWLEDGE for null/undefined', () => {
      expect(getSectionForSubtype(null)).toBe('KNOWLEDGE');
      expect(getSectionForSubtype(undefined)).toBe('KNOWLEDGE');
    });
  });

  describe('SECTION_PROFILES', () => {
    it('has a profile for every section', () => {
      for (const section of MEMORY_SECTIONS) {
        expect(SECTION_PROFILES[section]).toBeDefined();
      }
    });

    it('all reranking weights sum to 1.0', () => {
      for (const [section, profile] of Object.entries(SECTION_PROFILES)) {
        const w = profile.reranking_weights;
        const sum = w.semantic + w.keyword + w.graph + w.recency + w.authority + w.affinity;
        expect(sum).toBeCloseTo(1.0, 2);
      }
    });

    it('all decay configs have valid thresholds', () => {
      for (const [section, profile] of Object.entries(SECTION_PROFILES)) {
        expect(profile.decay.weak_threshold).toBeLessThan(profile.decay.active_threshold);
        expect(profile.decay.initial_stability_days).toBeGreaterThan(0);
        expect(profile.decay.max_stability_days).toBeGreaterThan(profile.decay.initial_stability_days);
      }
    });

    it('validateSectionProfiles does not throw', () => {
      expect(() => validateSectionProfiles()).not.toThrow();
    });
  });

  describe('getInitialStabilityForSubtype', () => {
    it('returns per-subtype override when available', () => {
      expect(getInitialStabilityForSubtype('custom:signal')).toBe(2);
      expect(getInitialStabilityForSubtype('custom:lesson')).toBe(90);
      expect(getInitialStabilityForSubtype('custom:playbook')).toBe(180);
    });

    it('falls back to section default for unmapped subtypes', () => {
      expect(getInitialStabilityForSubtype('custom:unknown')).toBe(60); // KNOWLEDGE default
    });

    it('falls back to section default for null', () => {
      expect(getInitialStabilityForSubtype(null)).toBe(60); // KNOWLEDGE default
    });
  });

  describe('SUBTYPE_INITIAL_STABILITY', () => {
    it('covers all subtypes in SUBTYPE_TO_SECTION', () => {
      for (const subtype of Object.keys(SUBTYPE_TO_SECTION)) {
        expect(SUBTYPE_INITIAL_STABILITY[subtype]).toBeDefined();
      }
    });
  });
});
```

**Run with:**
```bash
cd nous-server/core
npx vitest run src/sections/__tests__/sections.test.ts
```

**Expected:** All tests pass.

### Unit Tests (Python)

**New file:** `tests/unit/test_sections.py`

```python
"""Unit tests for the memory sections module."""

import pytest
from hynous.nous.sections import (
    MemorySection,
    SUBTYPE_TO_SECTION,
    MEMORY_TYPE_TO_SECTION,
    SECTION_PROFILES,
    SUBTYPE_INITIAL_STABILITY,
    get_section_for_subtype,
    get_section_for_memory_type,
    get_section_profile,
    get_profile_for_subtype,
    get_initial_stability_for_subtype,
    RerankingWeights,
)


class TestMemorySection:
    def test_has_four_sections(self):
        assert len(MemorySection) == 4

    def test_section_values(self):
        assert MemorySection.EPISODIC.value == "EPISODIC"
        assert MemorySection.SIGNALS.value == "SIGNALS"
        assert MemorySection.KNOWLEDGE.value == "KNOWLEDGE"
        assert MemorySection.PROCEDURAL.value == "PROCEDURAL"


class TestSubtypeToSection:
    def test_maps_all_16_subtypes(self):
        assert len(SUBTYPE_TO_SECTION) == 16

    def test_episodic_subtypes(self):
        episodic = ["custom:trade_entry", "custom:trade_close", "custom:trade_modify",
                     "custom:trade", "custom:turn_summary", "custom:session_summary",
                     "custom:market_event"]
        for st in episodic:
            assert SUBTYPE_TO_SECTION[st] == MemorySection.EPISODIC, f"{st} should be EPISODIC"

    def test_signal_subtypes(self):
        assert SUBTYPE_TO_SECTION["custom:signal"] == MemorySection.SIGNALS
        assert SUBTYPE_TO_SECTION["custom:watchpoint"] == MemorySection.SIGNALS

    def test_knowledge_subtypes(self):
        assert SUBTYPE_TO_SECTION["custom:lesson"] == MemorySection.KNOWLEDGE
        assert SUBTYPE_TO_SECTION["custom:thesis"] == MemorySection.KNOWLEDGE
        assert SUBTYPE_TO_SECTION["custom:curiosity"] == MemorySection.KNOWLEDGE

    def test_procedural_subtypes(self):
        assert SUBTYPE_TO_SECTION["custom:playbook"] == MemorySection.PROCEDURAL
        assert SUBTYPE_TO_SECTION["custom:missed_opportunity"] == MemorySection.PROCEDURAL
        assert SUBTYPE_TO_SECTION["custom:good_pass"] == MemorySection.PROCEDURAL


class TestGetSectionForSubtype:
    def test_known_subtypes(self):
        assert get_section_for_subtype("custom:signal") == MemorySection.SIGNALS
        assert get_section_for_subtype("custom:lesson") == MemorySection.KNOWLEDGE

    def test_unknown_subtype_defaults_to_knowledge(self):
        assert get_section_for_subtype("custom:unknown") == MemorySection.KNOWLEDGE

    def test_none_defaults_to_knowledge(self):
        assert get_section_for_subtype(None) == MemorySection.KNOWLEDGE


class TestGetSectionForMemoryType:
    def test_agent_facing_names(self):
        assert get_section_for_memory_type("signal") == MemorySection.SIGNALS
        assert get_section_for_memory_type("lesson") == MemorySection.KNOWLEDGE
        assert get_section_for_memory_type("trade_entry") == MemorySection.EPISODIC
        assert get_section_for_memory_type("playbook") == MemorySection.PROCEDURAL

    def test_episode_maps_to_episodic(self):
        # "episode" is the agent-facing name that maps to custom:market_event
        assert get_section_for_memory_type("episode") == MemorySection.EPISODIC


class TestSectionProfiles:
    def test_all_sections_have_profiles(self):
        for section in MemorySection:
            assert section in SECTION_PROFILES

    def test_reranking_weights_sum_to_one(self):
        for section, profile in SECTION_PROFILES.items():
            w = profile.reranking_weights
            total = w.semantic + w.keyword + w.graph + w.recency + w.authority + w.affinity
            assert abs(total - 1.0) < 0.01, f"{section} weights sum to {total}"

    def test_decay_thresholds_ordered(self):
        for section, profile in SECTION_PROFILES.items():
            assert profile.decay.weak_threshold < profile.decay.active_threshold, (
                f"{section}: weak >= active"
            )

    def test_decay_stability_positive(self):
        for section, profile in SECTION_PROFILES.items():
            assert profile.decay.initial_stability_days > 0
            assert profile.decay.max_stability_days > profile.decay.initial_stability_days


class TestRerankingWeightsValidation:
    def test_valid_weights(self):
        w = RerankingWeights(semantic=0.30, keyword=0.15, graph=0.20,
                             recency=0.15, authority=0.10, affinity=0.10)
        assert w.semantic == 0.30

    def test_invalid_weights_raise(self):
        with pytest.raises(ValueError):
            RerankingWeights(semantic=0.50, keyword=0.50, graph=0.50,
                             recency=0.50, authority=0.50, affinity=0.50)


class TestInitialStability:
    def test_all_subtypes_have_stability(self):
        for subtype in SUBTYPE_TO_SECTION:
            assert subtype in SUBTYPE_INITIAL_STABILITY, f"Missing stability for {subtype}"

    def test_signals_decay_fastest(self):
        signal_stability = get_initial_stability_for_subtype("custom:signal")
        lesson_stability = get_initial_stability_for_subtype("custom:lesson")
        assert signal_stability < lesson_stability

    def test_playbooks_most_durable(self):
        playbook_stability = get_initial_stability_for_subtype("custom:playbook")
        for subtype in SUBTYPE_TO_SECTION:
            stability = get_initial_stability_for_subtype(subtype)
            assert playbook_stability >= stability, (
                f"Playbook ({playbook_stability}d) should be >= {subtype} ({stability}d)"
            )

    def test_fallback_for_unknown(self):
        stability = get_initial_stability_for_subtype("custom:future_type")
        assert stability == 60  # KNOWLEDGE section default


class TestSyncWithTypeScript:
    """Verify Python and TypeScript definitions are in sync."""

    def test_subtype_count_matches(self):
        # TypeScript has 16 entries in SUBTYPE_TO_SECTION
        assert len(SUBTYPE_TO_SECTION) == 16

    def test_stability_count_matches(self):
        # TypeScript has entries for all 16 subtypes
        assert len(SUBTYPE_INITIAL_STABILITY) == 16

    def test_section_count_matches(self):
        # TypeScript has 4 sections
        assert len(MemorySection) == 4
```

**Run with:**
```bash
cd /path/to/project
PYTHONPATH=src python -m pytest tests/unit/test_sections.py -v
```

**Expected:** All tests pass.

### Integration Tests (Live Local)

These tests require the Nous server running locally.

**Prerequisites:**
```bash
# Terminal 1: Start Nous server
cd nous-server/server
pnpm dev
# Should show: "Nous server running on port 3100"
```

**Test 1: Verify `memory_section` field appears in search results**
```bash
# Create a test node
curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{"type": "concept", "subtype": "custom:signal", "content_title": "Test signal for section check", "content_body": "BTC funding rate spike detected at 0.15%"}' | jq '.id, .subtype'

# Wait 2s for embedding
sleep 2

# Search and check for memory_section field
curl -s -X POST http://localhost:3100/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "BTC funding rate spike", "limit": 5}' | jq '.data[0] | {id, subtype, memory_section, score}'
```

**Expected:** The response includes `"memory_section": "SIGNALS"` for the signal node.

**Test 2: Verify section classification for different subtypes**
```bash
# Create nodes of different types
curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{"type": "concept", "subtype": "custom:lesson", "content_title": "Test lesson for section check", "content_body": "Never chase pumps after 3 consecutive green candles"}' | jq '.id'

curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{"type": "concept", "subtype": "custom:playbook", "content_title": "Test playbook for section check", "content_body": "Funding squeeze playbook: short when funding > 0.10%"}' | jq '.id'

sleep 2

# Search and verify sections
curl -s -X POST http://localhost:3100/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "section check test", "limit": 10}' | jq '.data[] | {subtype, memory_section}'
```

**Expected:**
```json
{"subtype": "custom:signal", "memory_section": "SIGNALS"}
{"subtype": "custom:lesson", "memory_section": "KNOWLEDGE"}
{"subtype": "custom:playbook", "memory_section": "PROCEDURAL"}
```

### Live Dynamic Tests (VPS)

After deploying the updated Nous server to VPS:

**Test 3: Verify existing production nodes get section classification**
```bash
# SSH to VPS, then:
curl -s -X POST http://localhost:3100/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "ETH trade funding", "limit": 5}' | jq '.data[] | {id, subtype, memory_section}'
```

**Expected:** All returned nodes have a `memory_section` field matching their subtype:
- `custom:trade_entry` → `EPISODIC`
- `custom:signal` → `SIGNALS`
- `custom:lesson` → `KNOWLEDGE`
- etc.

**Test 4: Verify Python sections module works**
```bash
# From project root (local or VPS):
PYTHONPATH=src python -c "
from hynous.nous.sections import get_section_for_subtype, MemorySection, SECTION_PROFILES
print(get_section_for_subtype('custom:signal'))   # Should print: MemorySection.SIGNALS
print(get_section_for_subtype('custom:lesson'))   # Should print: MemorySection.KNOWLEDGE
print(get_section_for_subtype(None))              # Should print: MemorySection.KNOWLEDGE
for s, p in SECTION_PROFILES.items():
    print(f'{s.value}: weights sum = {p.reranking_weights.semantic + p.reranking_weights.keyword + p.reranking_weights.graph + p.reranking_weights.recency + p.reranking_weights.authority + p.reranking_weights.affinity:.2f}')
"
```

**Expected:**
```
MemorySection.SIGNALS
MemorySection.KNOWLEDGE
MemorySection.KNOWLEDGE
EPISODIC: weights sum = 1.00
SIGNALS: weights sum = 1.00
KNOWLEDGE: weights sum = 1.00
PROCEDURAL: weights sum = 1.00
```

---

## Verification Checklist

| # | Check | How to Verify |
|---|-------|---------------|
| 1 | TypeScript sections module compiles | `cd nous-server/core && npx tsup` — no errors |
| 2 | TypeScript sections tests pass | `npx vitest run src/sections/__tests__/sections.test.ts` — all green |
| 3 | Existing SSA tests still pass | `npx vitest run src/ssa/` — no regressions |
| 4 | Existing params tests still pass | `npx vitest run src/params/` — no regressions |
| 5 | Python sections module imports | `PYTHONPATH=src python -c "from hynous.nous.sections import MemorySection"` |
| 6 | Python unit tests pass | `PYTHONPATH=src python -m pytest tests/unit/test_sections.py -v` — all green |
| 7 | Existing Python tests still pass | `PYTHONPATH=src python -m pytest tests/ -v` — no regressions |
| 8 | `memory_section` field in search results | Local Nous: create node, search, verify field present |
| 9 | Section classification correct | Create nodes of each subtype, verify correct section in response |
| 10 | Python config loads with sections | `PYTHONPATH=src python -c "from hynous.core.config import load_config; c = load_config(); print(c.sections)"` |
| 11 | YAML config accepted | Add `sections:` block to `default.yaml`, verify no load errors |
| 12 | Python-TS sync | Count subtypes in both mappings: both should have 16 entries |

---

## File Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `nous-server/core/src/sections/index.ts` | **NEW** | Section types, mapping, profiles, validation (~280 lines) |
| `nous-server/core/src/sections/__tests__/sections.test.ts` | **NEW** | TypeScript unit tests (~120 lines) |
| `nous-server/core/tsup.config.ts` | Modified | Add `sections/index.ts` entry point (+1 line) |
| `nous-server/core/src/index.ts` | Modified | Re-export sections module (+1 line) |
| `nous-server/server/src/core-bridge.ts` | Modified | Import sections, add `memory_section` to `applyDecay()` response (+6 lines) |
| `src/hynous/nous/sections.py` | **NEW** | Python mirror of section definitions (~290 lines) |
| `src/hynous/core/config.py` | Modified | Add `SectionsConfig` dataclass + YAML loading (+15 lines) |
| `config/default.yaml` | Modified | Add `sections:` config block (+6 lines) |
| `tests/unit/test_sections.py` | **NEW** | Python unit tests (~130 lines) |

**Total new code:** ~820 lines (TypeScript + Python + tests)
**Total modified:** ~25 lines across 4 existing files
**Schema changes:** None
**API changes:** `memory_section` field added to search results (additive, non-breaking)

---

## What Comes Next

After this guide is implemented, the section infrastructure exists but is **passive** — nothing uses it yet for actual behavior changes. The following guides activate it:

- **Issue 1** uses `SECTION_PROFILES[section].reranking_weights` in SSA's `rerankCandidates()`
- **Issue 2** uses `SECTION_PROFILES[section].decay` and `SUBTYPE_INITIAL_STABILITY` in `computeDecay()` and `getNeuralDefaults()`
- **Issue 6** uses `get_section_for_subtype()` and `intent_boost` in the Python retrieval orchestrator
- **Issue 4** uses `SECTION_PROFILES[section].encoding` and `salience_enabled` in `_store_memory_impl()`
- **Issue 3** uses `consolidation_role` to determine source/target sections
- **Issue 5** adds pattern-match retrieval for the PROCEDURAL section
