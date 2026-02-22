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

// Named SectionRerankingWeightsSchema to avoid collision with params/RerankingWeightsSchema
export const SectionRerankingWeightsSchema = z.object({
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
    SectionRerankingWeightsSchema.parse(profile.reranking_weights);
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
