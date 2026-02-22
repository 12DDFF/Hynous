import { z } from 'zod';

// src/sections/index.ts
var MEMORY_SECTIONS = ["EPISODIC", "SIGNALS", "KNOWLEDGE", "PROCEDURAL"];
var SUBTYPE_TO_SECTION = {
  // EPISODIC — What happened
  "custom:trade_entry": "EPISODIC",
  "custom:trade_close": "EPISODIC",
  "custom:trade_modify": "EPISODIC",
  "custom:trade": "EPISODIC",
  // Legacy subtype, rarely used
  "custom:turn_summary": "EPISODIC",
  "custom:session_summary": "EPISODIC",
  "custom:market_event": "EPISODIC",
  // SIGNALS — What to watch
  "custom:signal": "SIGNALS",
  "custom:watchpoint": "SIGNALS",
  // KNOWLEDGE — What I've learned
  "custom:lesson": "KNOWLEDGE",
  "custom:thesis": "KNOWLEDGE",
  "custom:curiosity": "KNOWLEDGE",
  // PROCEDURAL — How to act
  "custom:playbook": "PROCEDURAL",
  "custom:missed_opportunity": "PROCEDURAL",
  "custom:good_pass": "PROCEDURAL"
};
function getSectionForSubtype(subtype) {
  if (!subtype) return "KNOWLEDGE";
  return SUBTYPE_TO_SECTION[subtype] ?? "KNOWLEDGE";
}
var SECTION_PROFILES = {
  EPISODIC: {
    name: "Episodic",
    section: "EPISODIC",
    reranking_weights: {
      semantic: 0.2,
      keyword: 0.15,
      graph: 0.15,
      recency: 0.3,
      authority: 0.1,
      affinity: 0.1
    },
    decay: {
      initial_stability_days: 14,
      growth_rate: 2,
      active_threshold: 0.5,
      weak_threshold: 0.1,
      max_stability_days: 180
    },
    encoding: {
      base_difficulty: 0.3,
      salience_enabled: true,
      max_salience_multiplier: 2
    },
    consolidation_role: "source",
    intent_boost: 1.3
  },
  SIGNALS: {
    name: "Signals",
    section: "SIGNALS",
    reranking_weights: {
      semantic: 0.15,
      keyword: 0.1,
      graph: 0.1,
      recency: 0.45,
      authority: 0.1,
      affinity: 0.1
    },
    decay: {
      initial_stability_days: 2,
      growth_rate: 1.5,
      active_threshold: 0.5,
      weak_threshold: 0.15,
      max_stability_days: 30
    },
    encoding: {
      base_difficulty: 0.2,
      salience_enabled: false,
      max_salience_multiplier: 1
    },
    consolidation_role: "source",
    intent_boost: 1.3
  },
  KNOWLEDGE: {
    name: "Knowledge",
    section: "KNOWLEDGE",
    reranking_weights: {
      semantic: 0.35,
      keyword: 0.15,
      graph: 0.2,
      recency: 0.05,
      authority: 0.2,
      affinity: 0.05
    },
    decay: {
      initial_stability_days: 60,
      growth_rate: 3,
      active_threshold: 0.4,
      weak_threshold: 0.05,
      max_stability_days: 365
    },
    encoding: {
      base_difficulty: 0.4,
      salience_enabled: true,
      max_salience_multiplier: 2
    },
    consolidation_role: "target",
    intent_boost: 1.3
  },
  PROCEDURAL: {
    name: "Procedural",
    section: "PROCEDURAL",
    reranking_weights: {
      semantic: 0.25,
      keyword: 0.25,
      graph: 0.2,
      recency: 0.05,
      authority: 0.15,
      affinity: 0.1
    },
    decay: {
      initial_stability_days: 120,
      growth_rate: 3.5,
      active_threshold: 0.3,
      weak_threshold: 0.03,
      max_stability_days: 365
    },
    encoding: {
      base_difficulty: 0.5,
      salience_enabled: true,
      max_salience_multiplier: 3
    },
    consolidation_role: "target",
    intent_boost: 1.3
  }
};
var SectionDecayConfigSchema = z.object({
  initial_stability_days: z.number().positive(),
  growth_rate: z.number().positive(),
  active_threshold: z.number().min(0).max(1),
  weak_threshold: z.number().min(0).max(1),
  max_stability_days: z.number().positive()
});
var SectionEncodingConfigSchema = z.object({
  base_difficulty: z.number().min(0).max(1),
  salience_enabled: z.boolean(),
  max_salience_multiplier: z.number().min(1)
});
var SectionRerankingWeightsSchema = z.object({
  semantic: z.number().min(0).max(1),
  keyword: z.number().min(0).max(1),
  graph: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  authority: z.number().min(0).max(1),
  affinity: z.number().min(0).max(1)
}).refine(
  (w) => Math.abs(w.semantic + w.keyword + w.graph + w.recency + w.authority + w.affinity - 1) < 0.01,
  { message: "Reranking weights must sum to 1.0" }
);
function validateSectionProfiles() {
  for (const [section, profile] of Object.entries(SECTION_PROFILES)) {
    SectionDecayConfigSchema.parse(profile.decay);
    SectionEncodingConfigSchema.parse(profile.encoding);
    SectionRerankingWeightsSchema.parse(profile.reranking_weights);
    if (profile.decay.weak_threshold >= profile.decay.active_threshold) {
      throw new Error(`Section ${section}: weak_threshold must be < active_threshold`);
    }
  }
}
validateSectionProfiles();
var SUBTYPE_INITIAL_STABILITY = {
  // EPISODIC section (default: 14 days)
  "custom:trade_entry": 21,
  // Trade records should persist
  "custom:trade_close": 21,
  // Outcomes are valuable
  "custom:trade_modify": 14,
  // Position adjustments — section default
  "custom:trade": 14,
  // Legacy — section default
  "custom:turn_summary": 7,
  // Compressed exchanges — fast decay
  "custom:session_summary": 14,
  // Session digests — section default
  "custom:market_event": 10,
  // External events — medium
  // SIGNALS section (default: 2 days)
  "custom:signal": 2,
  // Market signals — very fast decay
  "custom:watchpoint": 5,
  // Watchpoints persist slightly longer (user-set)
  // KNOWLEDGE section (default: 60 days)
  "custom:lesson": 90,
  // Hard-won lessons — very durable
  "custom:thesis": 30,
  // Theses have time-bound validity
  "custom:curiosity": 14,
  // Curiosity items are exploratory
  // PROCEDURAL section (default: 120 days)
  "custom:playbook": 180,
  // Validated playbooks — nearly permanent
  "custom:missed_opportunity": 30,
  // Regret items — medium persistence
  "custom:good_pass": 30
  // Good passes — medium persistence
};
function getInitialStabilityForSubtype(subtype) {
  if (subtype && subtype in SUBTYPE_INITIAL_STABILITY) {
    return SUBTYPE_INITIAL_STABILITY[subtype];
  }
  const section = getSectionForSubtype(subtype);
  return SECTION_PROFILES[section].decay.initial_stability_days;
}

export { MEMORY_SECTIONS, SECTION_PROFILES, SUBTYPE_INITIAL_STABILITY, SUBTYPE_TO_SECTION, SectionDecayConfigSchema, SectionEncodingConfigSchema, SectionRerankingWeightsSchema, getInitialStabilityForSubtype, getSectionForSubtype, validateSectionProfiles };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map