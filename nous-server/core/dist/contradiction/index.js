import { z } from 'zod';

// src/contradiction/constants.ts
var DETECTION_TIERS = [
  "STRUCTURAL",
  "NORMALIZED",
  "PATTERN",
  "CLASSIFIER",
  "LLM",
  "VERIFICATION"
];
var DetectionTierSchema = z.enum(DETECTION_TIERS);
function isDetectionTier(value) {
  return DETECTION_TIERS.includes(value);
}
var DETECTION_TIER_METADATA = {
  STRUCTURAL: { speed_ms: 1, cost: 0, accuracy: 0.95 },
  NORMALIZED: { speed_ms: 3, cost: 0, accuracy: 0.9 },
  PATTERN: { speed_ms: 10, cost: 0, accuracy: 0.75 },
  CLASSIFIER: { speed_ms: 20, cost: 1e-4, accuracy: 0.85 },
  LLM: { speed_ms: 500, cost: 2e-3, accuracy: 0.92 },
  VERIFICATION: { speed_ms: 1e3, cost: 4e-3, accuracy: 0.97 }
};
var TIER_THRESHOLDS = {
  /** Tier 1: Structural match confidence */
  structural_confidence: 0.95,
  /** Tier 1.5: Normalized match confidence */
  normalized_confidence: 0.9,
  /** Tier 2: Pattern high confidence - proceed to resolution */
  pattern_high_threshold: 0.7,
  /** Tier 2: Pattern continue threshold - proceed to Tier 2.5 */
  pattern_continue_threshold: 0.4,
  /** Tier 2.5: Classifier threshold to proceed */
  classifier_threshold: 0.7,
  /** Tier 3: LLM confidence for auto-supersession (requires Tier 4) */
  llm_auto_threshold: 0.8,
  /** Tier 4: Verification confidence for auto-supersession */
  verification_threshold: 0.7
};
var CONFLICT_TYPES = [
  "FACT_UPDATE",
  "CORRECTION",
  "BELIEF_CONTRADICTION",
  "BELIEF_EVOLUTION",
  "SOURCE_CONFLICT",
  "AMBIGUOUS"
];
var ConflictTypeSchema = z.enum(CONFLICT_TYPES);
function isConflictType(value) {
  return CONFLICT_TYPES.includes(value);
}
var RESOLUTION_STRATEGIES = [
  "supersede_old",
  "keep_both_linked",
  "keep_both_unlinked",
  "queue_for_user",
  "source_ranking"
];
var ResolutionStrategySchema = z.enum(RESOLUTION_STRATEGIES);
var CONFLICT_TYPE_RESOLUTION = {
  FACT_UPDATE: {
    auto_supersede: true,
    resolution: "supersede_old",
    description: "Same entity+attribute, different value. New replaces old."
  },
  CORRECTION: {
    auto_supersede: true,
    resolution: "supersede_old",
    description: "Explicit correction marker detected. New replaces old."
  },
  BELIEF_CONTRADICTION: {
    auto_supersede: true,
    resolution: "supersede_old",
    description: "Same topic, sentiment flip (+ to - or - to +). New replaces old."
  },
  BELIEF_EVOLUTION: {
    auto_supersede: false,
    resolution: "keep_both_linked",
    description: "Same topic, similar sentiment, scope expanded. Keep both with evolves_from edge."
  },
  SOURCE_CONFLICT: {
    auto_supersede: true,
    resolution: "source_ranking",
    description: "Same fact from different sources. Higher trust source wins."
  },
  AMBIGUOUS: {
    auto_supersede: false,
    resolution: "queue_for_user",
    description: "LLM confidence < 0.7. Queue for user resolution."
  }
};
var SUPERSEDED_STATES = [
  "SUPERSEDED_ACTIVE",
  "SUPERSEDED_FADING",
  "SUPERSEDED_DORMANT",
  "SUPERSEDED_ARCHIVED",
  "SUPERSEDED_DELETED"
];
var SupersededStateSchema = z.enum(SUPERSEDED_STATES);
function isSupersededState(value) {
  return SUPERSEDED_STATES.includes(value);
}
var SUPERSEDED_DECAY_MULTIPLIERS = {
  SUPERSEDED_ACTIVE: 3,
  SUPERSEDED_FADING: 4,
  SUPERSEDED_DORMANT: 5,
  SUPERSEDED_ARCHIVED: 5,
  SUPERSEDED_DELETED: 0
};
var SUPERSEDED_ACCESS_DECAY_MULTIPLIER = 2;
var SUPERSEDED_R_THRESHOLDS = {
  /** Above this: SUPERSEDED_ACTIVE */
  active_min: 0.3,
  /** Between fading_min and active_min: SUPERSEDED_FADING */
  fading_min: 0.1,
  /** Below fading_min: SUPERSEDED_DORMANT */
  dormant_max: 0.1
};
var SUPERSEDED_DORMANT_DAYS = 90;
var DELETION_CRITERIA = {
  /** 1. Must be archived for this many days */
  min_archived_days: 180,
  /** 2. Must have zero accesses since archival */
  required_access_count: 0,
  /** 3. No incoming edges with strength above this */
  max_edge_strength: 0.5,
  /** 4. Superseding node must still be active */
  superseding_must_be_active: true,
  /** 5. Raw source must exist in Archive Layer */
  raw_must_exist: true
};
var STORAGE_PRESSURE_THRESHOLD = 0.8;
var CONFLICT_QUEUE_CONFIG = {
  /** Maximum items in queue - oldest auto-resolves on overflow */
  max_items: 20,
  /** Days before auto-resolve to "keep both" */
  auto_resolve_days: 14,
  /** Auto-resolve strategy */
  auto_resolve_strategy: "keep_both",
  /** Weekly prompt day (0=Sunday, 1=Monday) */
  weekly_prompt_day: 1
};
var CONFLICT_STATUSES = ["pending", "resolved", "auto_resolved"];
var ConflictStatusSchema = z.enum(CONFLICT_STATUSES);
var USER_RESOLUTIONS = [
  "old_is_current",
  "new_is_current",
  "keep_both",
  "merge"
];
var UserResolutionSchema = z.enum(USER_RESOLUTIONS);
var USER_RESOLUTION_DESCRIPTIONS = {
  old_is_current: "Keep the old information as current. Discard the new.",
  new_is_current: "The new information supersedes the old.",
  keep_both: "Both are valid. Keep both without supersession.",
  merge: "Create a merged version combining both."
};
var ACCURACY_MODES = ["FAST", "BALANCED", "THOROUGH", "MANUAL"];
var AccuracyModeSchema = z.enum(ACCURACY_MODES);
function isAccuracyMode(value) {
  return ACCURACY_MODES.includes(value);
}
var ACCURACY_TARGETS = {
  STRUCTURAL: 0.95,
  NORMALIZED: 0.9,
  PATTERN: 0.75,
  CLASSIFIER: 0.85,
  LLM: 0.92,
  VERIFICATION: 0.97
};
var AUTO_SUPERSEDE_ACCURACY_TARGET = 0.97;
var CLASSIFIER_TRAINING = {
  /** Train initial model at this many examples */
  initial_train_examples: 500,
  /** Retrain with full dataset at this many examples */
  retrain_examples: 2e3,
  /** Minimum accuracy before alerting */
  accuracy_alert_threshold: 0.85,
  /** Auto-supersede accuracy below this triggers conservative mode */
  auto_mode_switch_threshold: 0.95
};
var ATTRIBUTE_SYNONYMS = {
  "contact.phone": ["phone", "cell", "mobile", "number", "telephone"],
  "contact.email": ["email", "mail", "e-mail"],
  "belief.stance": ["thinks", "believes", "opinion", "stance", "position", "view"],
  "location.residence": ["lives", "resides", "located", "staying", "address"],
  "meeting.date": ["meeting", "appointment", "scheduled"],
  "project.status": ["project", "deadline", "due"]
};
var PATTERN_TRIGGERS = [
  "actually",
  "I was wrong",
  "correction:",
  "update:",
  "no longer",
  "changed to",
  "now it's",
  "turns out",
  "not anymore",
  "used to be"
];
var PATTERN_DISQUALIFIERS = [
  "wasn't actually",
  "not really",
  "wrong to doubt",
  "wrong of me",
  "was I wrong?",
  "is it actually?",
  "good point",
  "actually, yes",
  "actually enjoyed",
  "actually quite",
  "actually like",
  "actually think"
];
var PATTERN_CONFIDENCE_WEIGHTS = {
  /** Base confidence when trigger found */
  base: 0.5,
  /** Add if entity reference within 10 words */
  entity_nearby: 0.15,
  /** Add if factual value present */
  has_value: 0.1,
  /** Add if temporal signal present */
  temporal_signal: 0.1,
  /** Subtract if any disqualifier found */
  disqualifier_penalty: -0.3
};
var ENTITY_NEARBY_DISTANCE = 10;
var HISTORY_MODE_PATTERNS = [
  "used to",
  "before",
  "previously",
  "originally",
  "changed",
  "updated",
  "evolved",
  "history of",
  "what did I think",
  "how has .* changed"
];
var HISTORY_MODE_SUPERSEDED_PENALTY = 0.5;
var SSA_SUPERSEDED_ACTIVATION_CAP = 0.3;
var SSA_SUPERSEDED_SPREAD_DECAY = 0.5;
var QUERY_MODES = ["current", "as_of", "history", "full_audit"];
var QueryModeSchema = z.enum(QUERY_MODES);
function isQueryMode(value) {
  return QUERY_MODES.includes(value);
}
var SENTIMENTS = ["positive", "negative", "neutral"];
var SentimentSchema = z.enum(SENTIMENTS);
var DetectionContextSchema = z.object({
  old_value: z.string(),
  new_value: z.string(),
  old_timestamp: z.string().datetime(),
  new_timestamp: z.string().datetime(),
  old_source_confidence: z.number().min(0).max(1),
  new_source_confidence: z.number().min(0).max(1),
  has_sentiment_flip: z.boolean(),
  has_scope_expansion: z.boolean(),
  entity_id: z.string().optional(),
  attribute_type: z.string().optional(),
  has_correction_pattern: z.boolean()
});
var TypeClassificationSchema = z.object({
  type: ConflictTypeSchema,
  confidence: z.number().min(0).max(1),
  auto_supersede: z.boolean(),
  resolution: ResolutionStrategySchema,
  reasoning: z.string()
});
var TierResultSchema = z.object({
  tier: DetectionTierSchema,
  detected: z.boolean(),
  confidence: z.number().min(0).max(1),
  conflict_type: ConflictTypeSchema.optional(),
  should_continue: z.boolean(),
  reasoning: z.string().optional(),
  time_ms: z.number().min(0),
  cost: z.number().min(0)
});
var StructuralDetectionSchema = z.object({
  entity_id: z.string().optional(),
  attribute_type: z.string().optional(),
  old_value: z.string().optional(),
  new_value: z.string().optional(),
  match_found: z.boolean(),
  values_differ: z.boolean()
});
var NormalizationResultSchema = z.object({
  original_attribute: z.string(),
  normalized_attribute: z.string(),
  synonyms_matched: z.array(z.string()),
  implicit_extraction: z.object({
    pattern: z.string(),
    extracted_attribute: z.string(),
    extracted_value: z.string()
  }).optional()
});
var PatternDetectionSchema = z.object({
  triggers_found: z.array(z.string()),
  entity_nearby: z.boolean(),
  has_value: z.boolean(),
  temporal_signal: z.boolean(),
  disqualifiers_found: z.array(z.string()),
  confidence_score: z.number().min(0).max(1)
});
var ClassifierResultSchema = z.object({
  is_correction: z.boolean(),
  confidence: z.number().min(0).max(1),
  model_used: z.enum(["few_shot", "fine_tuned"])
});
var LLMDetectionOutputSchema = z.object({
  relationship: z.enum(["contradicts", "updates", "evolves", "coexists", "unrelated"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  which_is_current: z.enum(["old", "new", "both", "unclear"]),
  both_could_be_true: z.boolean(),
  is_time_dependent: z.boolean(),
  needs_user_input: z.boolean()
});
var VerificationOutputSchema = z.object({
  should_supersede: z.boolean(),
  confidence: z.number().min(0).max(1),
  concerns: z.array(z.string()),
  recommendation: z.enum(["auto_supersede", "queue_for_user", "keep_both"])
});
var DetectionPipelineResultSchema = z.object({
  final_tier: DetectionTierSchema,
  conflict_detected: z.boolean(),
  conflict_type: ConflictTypeSchema.optional(),
  overall_confidence: z.number().min(0).max(1),
  auto_supersede: z.boolean(),
  needs_user_resolution: z.boolean(),
  tier_results: z.array(TierResultSchema),
  total_time_ms: z.number().min(0),
  total_cost: z.number().min(0)
});
var SupersededStateConfigSchema = z.object({
  state: SupersededStateSchema,
  r_threshold_min: z.number().min(0).max(1).optional(),
  r_threshold_max: z.number().min(0).max(1).optional(),
  decay_multiplier: z.number().min(0),
  retrieval_mode: z.enum(["normal_excluded", "history_only", "audit_only", "none"]),
  content_state: z.enum(["full", "summarized", "reference_only", "deleted"]),
  duration_days: z.number().int().positive().optional()
});
var SupersessionFieldsSchema = z.object({
  superseded_by: z.string().optional(),
  superseded_at: z.string().datetime().optional(),
  superseded_state: SupersededStateSchema.optional(),
  decay_rate_multiplier: z.number().min(0).optional(),
  access_count_since_superseded: z.number().int().min(0).optional(),
  dormant_since: z.string().datetime().optional(),
  archived_at: z.string().datetime().optional()
});
var DeletionCriteriaResultSchema = z.object({
  eligible: z.boolean(),
  criteria: z.object({
    archived_long_enough: z.boolean(),
    days_archived: z.number().int().min(0),
    no_accesses: z.boolean(),
    access_count: z.number().int().min(0),
    no_important_edges: z.boolean(),
    max_edge_strength: z.number().min(0).max(1),
    superseding_active: z.boolean(),
    superseding_node_state: z.string().optional(),
    raw_in_archive: z.boolean()
  })
});
var SupersededStateTransitionSchema = z.object({
  node_id: z.string(),
  from_state: SupersededStateSchema,
  to_state: SupersededStateSchema,
  triggered_by: z.enum(["decay", "time", "storage_pressure", "user_access"]),
  timestamp: z.string().datetime(),
  context: z.object({
    retrievability: z.number().min(0).max(1).optional(),
    days_in_previous_state: z.number().int().min(0).optional(),
    user_accessed: z.boolean().optional()
  }).optional()
});
var ConflictQueueItemSchema = z.object({
  id: z.string(),
  old_node_id: z.string(),
  new_content: z.string(),
  new_node_id: z.string().optional(),
  conflict_type: ConflictTypeSchema,
  detection_tier: DetectionTierSchema,
  detection_confidence: z.number().min(0).max(1),
  context: z.string(),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  status: ConflictStatusSchema,
  entity_name: z.string().optional(),
  topic: z.string().optional()
});
var ContradictionResolutionSchema = z.object({
  conflict_id: z.string(),
  resolved_by: z.enum(["user", "auto", "timeout"]),
  resolution: UserResolutionSchema,
  resolved_at: z.string().datetime(),
  user_merged_content: z.string().optional(),
  was_override: z.boolean().optional()
});
var ConflictQueueStatusSchema = z.object({
  pending_count: z.number().int().min(0),
  oldest_pending_date: z.string().datetime().optional(),
  next_auto_resolve_date: z.string().datetime().optional(),
  items_resolved_this_week: z.number().int().min(0),
  at_capacity: z.boolean()
});
var ConflictPresentationSchema = z.object({
  conflict_id: z.string(),
  entity_name: z.string().optional(),
  topic: z.string(),
  version_a: z.object({
    content: z.string(),
    date: z.string(),
    source: z.string().optional()
  }),
  version_b: z.object({
    content: z.string(),
    date: z.string(),
    source: z.string().optional()
  }),
  suggested_action: UserResolutionSchema.optional(),
  confidence_in_suggestion: z.number().min(0).max(1),
  days_until_auto_resolve: z.number().int().min(0)
});
var ConflictQueueConfigSchema = z.object({
  max_items: z.number().int().positive(),
  auto_resolve_days: z.number().int().positive(),
  auto_resolve_strategy: UserResolutionSchema,
  weekly_prompt_enabled: z.boolean(),
  weekly_prompt_day: z.number().int().min(0).max(6)
});
var AccuracyModeConfigSchema = z.object({
  mode: AccuracyModeSchema,
  description: z.string(),
  tiers_used: z.array(DetectionTierSchema),
  auto_supersede_tiers: z.array(DetectionTierSchema),
  user_involvement: z.enum(["high", "medium", "low", "very_high"]),
  typical_speed_ms: z.number().min(0),
  typical_cost: z.number().min(0),
  expected_accuracy: z.number().min(0).max(1)
});
var DetectionEventLogSchema = z.object({
  id: z.string(),
  detection_id: z.string(),
  tier_reached: DetectionTierSchema,
  tier_confidence: z.number().min(0).max(1),
  auto_resolved: z.boolean(),
  resolution: z.enum(["supersede", "keep_both", "unrelated"]),
  user_override: z.enum(["agreed", "disagreed"]).optional(),
  user_resolution: UserResolutionSchema.optional(),
  timestamp: z.string().datetime(),
  accuracy_mode: AccuracyModeSchema,
  old_content: z.string().optional(),
  new_content: z.string().optional()
});
var AccuracyMetricsSchema = z.object({
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
  per_tier_accuracy: z.record(z.number().nullable()),
  false_positive_rate: z.number().min(0).max(1),
  false_negative_rate: z.number().min(0).max(1),
  auto_supersede_accuracy: z.number().min(0).max(1),
  total_detections: z.number().int().min(0),
  user_resolutions: z.number().int().min(0),
  by_mode: z.record(
    z.object({
      detections: z.number().int().min(0),
      accuracy: z.number().nullable()
    })
  )
});
var SelfImprovementConfigSchema = z.object({
  classifier_initial_train_examples: z.number().int().positive(),
  classifier_retrain_examples: z.number().int().positive(),
  accuracy_alert_threshold: z.number().min(0).max(1),
  auto_mode_switch_threshold: z.number().min(0).max(1)
});
var QCSHistoryModeConfigSchema = z.object({
  history_patterns: z.array(z.string()),
  superseded_penalty: z.number().min(0).max(1)
});
var HistoryModeDetectionSchema = z.object({
  is_history_mode: z.boolean(),
  matched_patterns: z.array(z.string()),
  suggested_mode: QueryModeSchema
});
var RCSSupersessionFlagSchema = z.object({
  flag: z.literal("has_superseded_history"),
  trigger: z.literal("top_result_has_superseded_by_chain"),
  explanation_text: z.string()
});
var SSASupersededConfigSchema = z.object({
  activation_cap: z.number().min(0).max(1),
  spread_decay: z.number().min(0).max(1),
  spread_to_superseding: z.boolean()
});
var Phase2ContextInjectionSchema = z.object({
  superseded_context_template: z.string(),
  follow_supersedes_for: z.array(z.string())
});
var QueryModeConfigSchema = z.object({
  mode: QueryModeSchema,
  include_superseded: z.boolean(),
  superseded_penalty: z.number().min(0).max(1),
  description: z.string()
});
var RetrievalIntegrationConfigSchema = z.object({
  qcs: QCSHistoryModeConfigSchema,
  rcs: RCSSupersessionFlagSchema,
  ssa: SSASupersededConfigSchema,
  phase2: Phase2ContextInjectionSchema
});
var Tier3InputSchema = z.object({
  entity_name: z.string(),
  entity_type: z.string(),
  attribute: z.string(),
  old_value: z.string(),
  old_date: z.string(),
  old_source: z.string(),
  new_statement: z.string(),
  context: z.string(),
  new_date: z.string(),
  new_source: z.string()
});
var Tier4InputSchema = z.object({
  old_value: z.string(),
  entity: z.string(),
  old_date: z.string(),
  new_statement: z.string(),
  new_date: z.string(),
  tier3_result: LLMDetectionOutputSchema
});

// src/contradiction/index.ts
var CLASSIFIER_FEW_SHOT_PROMPT = `Classify if this text is correcting previous information.

Examples of CORRECTIONS:
- "Actually, Sarah's phone is 555-5678" \u2192 CORRECTION
- "I was wrong about the meeting date, it's Thursday" \u2192 CORRECTION
- "Update: The deadline moved to next week" \u2192 CORRECTION

Examples of NOT corrections:
- "Actually, that's a great idea" \u2192 NOT (agreement)
- "I was wrong to doubt you" \u2192 NOT (apology)
- "I actually enjoyed the movie" \u2192 NOT (emphasis)
- "Was I wrong about this?" \u2192 NOT (question)

Text to classify: "{input_text}"
Context: "{surrounding_sentences}"

Is this a CORRECTION or NOT? Answer with confidence (0-1).`;
var LLM_DETECTION_PROMPT = `You are analyzing whether new information contradicts existing information in a personal knowledge base.

EXISTING INFORMATION:
- Entity: {entity_name}
- Type: {entity_type}
- Attribute: {attribute}
- Current value: "{old_value}"
- Recorded on: {old_date}
- Source: {old_source}

NEW INFORMATION:
- Statement: "{new_statement}"
- Context (surrounding text): "{context}"
- Date: {new_date}
- Source: {new_source}

IMPORTANT: Consider these possibilities:
1. TRUE CONTRADICTION: The facts cannot both be true
2. UPDATE: The fact changed over time (both were true at time)
3. EVOLUTION: The belief/opinion developed (not contradiction)
4. DIFFERENT CONTEXT: Both could be true in different contexts
5. UNRELATED: The new info is about something else entirely

Respond with ONLY this JSON (no other text):
{
  "relationship": "contradicts|updates|evolves|coexists|unrelated",
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation in 1-2 sentences>",
  "which_is_current": "old|new|both|unclear",
  "both_could_be_true": <true|false>,
  "is_time_dependent": <true|false>,
  "needs_user_input": <true|false>
}`;
var VERIFICATION_PROMPT = `A detection system believes these two pieces of information CONTRADICT each other:

EXISTING: "{old_value}" (about {entity}, recorded {old_date})
NEW: "{new_statement}" (from {new_date})

The system wants to AUTOMATICALLY mark the old information as superseded by the new information.

YOUR JOB: Find reasons this might be WRONG. Consider:
- Could they be about different things? (different Sarah?)
- Could both be true? (different contexts, times, aspects?)
- Is the "new" information actually a correction?
- Could this be a misunderstanding or ambiguity?

Respond with ONLY this JSON:
{
  "should_supersede": <true|false>,
  "confidence": <0.0-1.0>,
  "concerns": ["<concern1>", "<concern2>"] or [],
  "recommendation": "auto_supersede|queue_for_user|keep_both"
}`;
var SUPERSEDED_STATE_CONFIGS = {
  SUPERSEDED_ACTIVE: {
    state: "SUPERSEDED_ACTIVE",
    r_threshold_min: SUPERSEDED_R_THRESHOLDS.active_min,
    r_threshold_max: 1,
    decay_multiplier: SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_ACTIVE,
    retrieval_mode: "normal_excluded",
    content_state: "full",
    duration_days: void 0
  },
  SUPERSEDED_FADING: {
    state: "SUPERSEDED_FADING",
    r_threshold_min: SUPERSEDED_R_THRESHOLDS.fading_min,
    r_threshold_max: SUPERSEDED_R_THRESHOLDS.active_min,
    decay_multiplier: SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_FADING,
    retrieval_mode: "history_only",
    content_state: "full",
    duration_days: void 0
  },
  SUPERSEDED_DORMANT: {
    state: "SUPERSEDED_DORMANT",
    r_threshold_min: 0,
    r_threshold_max: SUPERSEDED_R_THRESHOLDS.dormant_max,
    decay_multiplier: SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_DORMANT,
    retrieval_mode: "audit_only",
    content_state: "summarized",
    duration_days: SUPERSEDED_DORMANT_DAYS
  },
  SUPERSEDED_ARCHIVED: {
    state: "SUPERSEDED_ARCHIVED",
    r_threshold_min: void 0,
    r_threshold_max: void 0,
    decay_multiplier: SUPERSEDED_DECAY_MULTIPLIERS.SUPERSEDED_ARCHIVED,
    retrieval_mode: "audit_only",
    content_state: "reference_only",
    duration_days: void 0
  },
  SUPERSEDED_DELETED: {
    state: "SUPERSEDED_DELETED",
    r_threshold_min: void 0,
    r_threshold_max: void 0,
    decay_multiplier: 0,
    retrieval_mode: "none",
    content_state: "deleted",
    duration_days: void 0
  }
};
var ACCURACY_MODE_CONFIGS = {
  FAST: {
    mode: "FAST",
    description: "I want quick responses, I'll fix mistakes manually",
    tiers_used: ["STRUCTURAL", "NORMALIZED", "PATTERN"],
    auto_supersede_tiers: ["STRUCTURAL"],
    user_involvement: "high",
    typical_speed_ms: 15,
    typical_cost: 0,
    expected_accuracy: 0.75
  },
  BALANCED: {
    mode: "BALANCED",
    description: "Good accuracy without too much cost/delay",
    tiers_used: ["STRUCTURAL", "NORMALIZED", "PATTERN", "CLASSIFIER", "LLM"],
    auto_supersede_tiers: ["STRUCTURAL", "NORMALIZED", "PATTERN"],
    user_involvement: "medium",
    typical_speed_ms: 50,
    typical_cost: 3e-3,
    expected_accuracy: 0.9
  },
  THOROUGH: {
    mode: "THOROUGH",
    description: "I want maximum accuracy, cost/speed doesn't matter",
    tiers_used: ["STRUCTURAL", "NORMALIZED", "PATTERN", "CLASSIFIER", "LLM", "VERIFICATION"],
    auto_supersede_tiers: ["STRUCTURAL", "NORMALIZED", "PATTERN", "LLM"],
    user_involvement: "low",
    typical_speed_ms: 1500,
    typical_cost: 6e-3,
    expected_accuracy: 0.97
  },
  MANUAL: {
    mode: "MANUAL",
    description: "I want to approve every change",
    tiers_used: ["STRUCTURAL", "NORMALIZED", "PATTERN"],
    auto_supersede_tiers: [],
    user_involvement: "very_high",
    typical_speed_ms: 15,
    typical_cost: 0,
    expected_accuracy: 1
  }
};
var QUERY_MODE_CONFIGS = {
  current: {
    mode: "current",
    include_superseded: false,
    superseded_penalty: 1,
    description: "Only active nodes (default)"
  },
  as_of: {
    mode: "as_of",
    include_superseded: true,
    superseded_penalty: 0,
    description: "What we knew at that date"
  },
  history: {
    mode: "history",
    include_superseded: true,
    superseded_penalty: HISTORY_MODE_SUPERSEDED_PENALTY,
    description: "Include superseded nodes with penalty"
  },
  full_audit: {
    mode: "full_audit",
    include_superseded: true,
    superseded_penalty: 0,
    description: "Everything including archived"
  }
};
var DEFAULT_QUEUE_CONFIG = {
  max_items: CONFLICT_QUEUE_CONFIG.max_items,
  auto_resolve_days: CONFLICT_QUEUE_CONFIG.auto_resolve_days,
  auto_resolve_strategy: CONFLICT_QUEUE_CONFIG.auto_resolve_strategy,
  weekly_prompt_enabled: true,
  weekly_prompt_day: CONFLICT_QUEUE_CONFIG.weekly_prompt_day
};
var DEFAULT_SELF_IMPROVEMENT_CONFIG = {
  classifier_initial_train_examples: CLASSIFIER_TRAINING.initial_train_examples,
  classifier_retrain_examples: CLASSIFIER_TRAINING.retrain_examples,
  accuracy_alert_threshold: CLASSIFIER_TRAINING.accuracy_alert_threshold,
  auto_mode_switch_threshold: CLASSIFIER_TRAINING.auto_mode_switch_threshold
};
var QCS_HISTORY_MODE_CONFIG = {
  history_patterns: HISTORY_MODE_PATTERNS,
  superseded_penalty: HISTORY_MODE_SUPERSEDED_PENALTY
};
var RCS_SUPERSESSION_FLAG = {
  flag: "has_superseded_history",
  trigger: "top_result_has_superseded_by_chain",
  explanation_text: "Note: This topic has historical versions"
};
var SSA_SUPERSEDED_CONFIG = {
  activation_cap: SSA_SUPERSEDED_ACTIVATION_CAP,
  spread_decay: SSA_SUPERSEDED_SPREAD_DECAY,
  spread_to_superseding: true
};
var PHASE2_CONTEXT_INJECTION = {
  superseded_context_template: 'Note: "{old_content}" was later updated to "{new_content}"',
  follow_supersedes_for: ["change", "evolution", "history", "before", "used to"]
};
var DEFAULT_RETRIEVAL_INTEGRATION_CONFIG = {
  qcs: QCS_HISTORY_MODE_CONFIG,
  rcs: RCS_SUPERSESSION_FLAG,
  ssa: SSA_SUPERSEDED_CONFIG,
  phase2: PHASE2_CONTEXT_INJECTION
};
var TYPE_DETECTION_CRITERIA = [
  {
    type: "FACT_UPDATE",
    priority: 1,
    matches: (ctx) => ctx.entity_id !== void 0 && ctx.attribute_type !== void 0 && ctx.old_value !== ctx.new_value && !ctx.has_correction_pattern,
    confidence: 0.95,
    auto_supersede: true,
    resolution: "supersede_old"
  },
  {
    type: "CORRECTION",
    priority: 2,
    matches: (ctx) => ctx.has_correction_pattern,
    confidence: 0.9,
    auto_supersede: true,
    resolution: "supersede_old"
  },
  {
    type: "BELIEF_CONTRADICTION",
    priority: 3,
    matches: (ctx) => ctx.has_sentiment_flip && !ctx.has_scope_expansion,
    confidence: 0.85,
    auto_supersede: true,
    resolution: "supersede_old"
  },
  {
    type: "BELIEF_EVOLUTION",
    priority: 4,
    matches: (ctx) => !ctx.has_sentiment_flip && ctx.has_scope_expansion,
    confidence: 0.8,
    auto_supersede: false,
    resolution: "keep_both_linked"
  },
  {
    type: "SOURCE_CONFLICT",
    priority: 5,
    matches: (ctx) => ctx.old_source_confidence !== ctx.new_source_confidence && Math.abs(ctx.old_source_confidence - ctx.new_source_confidence) > 0.2,
    confidence: 0.75,
    auto_supersede: true,
    resolution: "source_ranking"
  },
  {
    type: "AMBIGUOUS",
    priority: 6,
    matches: () => true,
    confidence: 0.5,
    auto_supersede: false,
    resolution: "queue_for_user"
  }
];
function daysSince(isoTimestamp) {
  const then = new Date(isoTimestamp).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1e3 * 60 * 60 * 24));
}
function generateConflictId() {
  return `conflict_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}
function generateEventId() {
  return `event_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}
function formatDate(isoTimestamp) {
  const date = new Date(isoTimestamp);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function classifyConflictType(_old_node, _new_content, context) {
  for (const criteria of TYPE_DETECTION_CRITERIA) {
    if (criteria.matches(context)) {
      return {
        type: criteria.type,
        confidence: criteria.confidence,
        auto_supersede: criteria.auto_supersede,
        resolution: criteria.resolution,
        reasoning: CONFLICT_TYPE_RESOLUTION[criteria.type].description
      };
    }
  }
  return {
    type: "AMBIGUOUS",
    confidence: 0.5,
    auto_supersede: false,
    resolution: "queue_for_user",
    reasoning: "Could not determine conflict type."
  };
}
function isAutoSupersede(type) {
  return CONFLICT_TYPE_RESOLUTION[type].auto_supersede;
}
function getResolutionStrategy(type) {
  return CONFLICT_TYPE_RESOLUTION[type].resolution;
}
function resolveSourceConflict(old_confidence, new_confidence) {
  return new_confidence >= old_confidence ? "new" : "old";
}
function hasSentimentFlip(old_sentiment, new_sentiment) {
  if (old_sentiment === "neutral" || new_sentiment === "neutral") {
    return false;
  }
  return old_sentiment !== new_sentiment;
}
function runTier2Pattern(content) {
  const lowerContent = content.toLowerCase();
  const triggers_found = [];
  const disqualifiers_found = [];
  for (const trigger of PATTERN_TRIGGERS) {
    if (lowerContent.includes(trigger.toLowerCase())) {
      triggers_found.push(trigger);
    }
  }
  for (const disqualifier of PATTERN_DISQUALIFIERS) {
    if (lowerContent.includes(disqualifier.toLowerCase())) {
      disqualifiers_found.push(disqualifier);
    }
  }
  const confidence_score = calculatePatternConfidence({
    entity_nearby: false,
    // Would need entity detection
    has_value: triggers_found.length > 0,
    temporal_signal: lowerContent.includes("now") || lowerContent.includes("used to"),
    disqualifiers_found});
  return {
    triggers_found,
    entity_nearby: false,
    has_value: triggers_found.length > 0,
    temporal_signal: lowerContent.includes("now") || lowerContent.includes("used to"),
    disqualifiers_found,
    confidence_score
  };
}
function calculatePatternConfidence(detection) {
  let confidence = PATTERN_CONFIDENCE_WEIGHTS.base;
  if (detection.entity_nearby) {
    confidence += PATTERN_CONFIDENCE_WEIGHTS.entity_nearby;
  }
  if (detection.has_value) {
    confidence += PATTERN_CONFIDENCE_WEIGHTS.has_value;
  }
  if (detection.temporal_signal) {
    confidence += PATTERN_CONFIDENCE_WEIGHTS.temporal_signal;
  }
  if (detection.disqualifiers_found.length > 0) {
    confidence += PATTERN_CONFIDENCE_WEIGHTS.disqualifier_penalty;
  }
  return Math.max(0, Math.min(1, confidence));
}
function runTier1_5Normalization(attribute, _content) {
  const lowerAttribute = attribute.toLowerCase();
  let normalized_attribute = attribute;
  const synonyms_matched = [];
  for (const [normalized, synonyms] of Object.entries(ATTRIBUTE_SYNONYMS)) {
    for (const synonym of synonyms) {
      if (lowerAttribute.includes(synonym.toLowerCase())) {
        normalized_attribute = normalized;
        synonyms_matched.push(synonym);
        break;
      }
    }
    if (synonyms_matched.length > 0) break;
  }
  return {
    original_attribute: attribute,
    normalized_attribute,
    synonyms_matched
  };
}
function shouldContinueToNextTier(result, mode) {
  if (mode === "FAST" && result.tier === "PATTERN") {
    return false;
  }
  if (mode === "MANUAL" && result.tier === "PATTERN") {
    return false;
  }
  if (result.detected && result.confidence >= TIER_THRESHOLDS.structural_confidence) {
    return false;
  }
  return result.should_continue;
}
function canAutoSupersede(tier3_result, tier4_result, mode) {
  if (mode === "MANUAL") {
    return false;
  }
  if (mode === "FAST") {
    return false;
  }
  if (!tier3_result || !tier4_result) {
    return false;
  }
  const pass1_ok = tier3_result.confidence >= TIER_THRESHOLDS.llm_auto_threshold;
  const pass2_ok = tier4_result.should_supersede && tier4_result.confidence >= TIER_THRESHOLDS.verification_threshold && tier4_result.concerns.length === 0;
  return pass1_ok && pass2_ok;
}
function determineSupersededState(node) {
  if (node.superseded_state === "SUPERSEDED_DELETED") {
    return "SUPERSEDED_DELETED";
  }
  if (node.superseded_state === "SUPERSEDED_ARCHIVED") {
    return "SUPERSEDED_ARCHIVED";
  }
  const R = node.neural.retrievability;
  if (R > SUPERSEDED_R_THRESHOLDS.active_min) {
    return "SUPERSEDED_ACTIVE";
  } else if (R > SUPERSEDED_R_THRESHOLDS.fading_min) {
    return "SUPERSEDED_FADING";
  } else {
    if (node.dormant_since) {
      const dormantDays = daysSince(node.dormant_since);
      if (dormantDays >= SUPERSEDED_DORMANT_DAYS) {
        return "SUPERSEDED_ARCHIVED";
      }
    }
    return "SUPERSEDED_DORMANT";
  }
}
function getDecayMultiplier(state) {
  return SUPERSEDED_DECAY_MULTIPLIERS[state];
}
function getEffectiveDecayMultiplier(state, userAccessed) {
  if (userAccessed) {
    return SUPERSEDED_ACCESS_DECAY_MULTIPLIER;
  }
  return SUPERSEDED_DECAY_MULTIPLIERS[state];
}
function checkStateTransition(node) {
  const currentState = node.superseded_state;
  if (!currentState || currentState === "SUPERSEDED_DELETED") {
    return null;
  }
  const newState = determineSupersededState(node);
  if (newState !== currentState) {
    let trigger = "decay";
    if (newState === "SUPERSEDED_ARCHIVED" && currentState === "SUPERSEDED_DORMANT") {
      trigger = "time";
    }
    return {
      node_id: node.id,
      from_state: currentState,
      to_state: newState,
      triggered_by: trigger,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      context: { retrievability: node.neural.retrievability }
    };
  }
  return null;
}
function checkDeletionCriteria(node, supersedingNode, maxIncomingEdgeStrength, rawInArchive) {
  const daysArchived = node.archived_at ? daysSince(node.archived_at) : 0;
  const accessCount = node.access_count_since_superseded ?? 0;
  const supersedingActive = supersedingNode !== null && supersedingNode.state.lifecycle === "active";
  const criteria = {
    archived_long_enough: daysArchived >= DELETION_CRITERIA.min_archived_days,
    days_archived: daysArchived,
    no_accesses: accessCount === DELETION_CRITERIA.required_access_count,
    access_count: accessCount,
    no_important_edges: maxIncomingEdgeStrength <= DELETION_CRITERIA.max_edge_strength,
    max_edge_strength: maxIncomingEdgeStrength,
    superseding_active: supersedingActive,
    superseding_node_state: supersedingNode?.state.lifecycle,
    raw_in_archive: rawInArchive
  };
  const eligible = criteria.archived_long_enough && criteria.no_accesses && criteria.no_important_edges && criteria.superseding_active && criteria.raw_in_archive;
  return { eligible, criteria };
}
function isStoragePressure(currentCapacity) {
  return currentCapacity >= STORAGE_PRESSURE_THRESHOLD;
}
function getRetrievalMode(state) {
  return SUPERSEDED_STATE_CONFIGS[state].retrieval_mode;
}
function getContentState(state) {
  return SUPERSEDED_STATE_CONFIGS[state].content_state;
}
function createConflictQueueItem(data) {
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + CONFLICT_QUEUE_CONFIG.auto_resolve_days);
  return {
    ...data,
    id: generateConflictId(),
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    status: "pending"
  };
}
function addToConflictQueue(queue, item) {
  const auto_resolved = [];
  let pendingItems = queue.filter((q) => q.status === "pending");
  while (pendingItems.length >= CONFLICT_QUEUE_CONFIG.max_items) {
    const oldest = pendingItems.reduce(
      (a, b) => new Date(a.created_at) < new Date(b.created_at) ? a : b
    );
    oldest.status = "auto_resolved";
    auto_resolved.push({
      conflict_id: oldest.id,
      resolved_by: "auto",
      resolution: CONFLICT_QUEUE_CONFIG.auto_resolve_strategy,
      resolved_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    pendingItems = queue.filter((q) => q.status === "pending");
  }
  queue.push(item);
  return { queue, auto_resolved };
}
function getPendingConflicts(queue) {
  return queue.filter((item) => item.status === "pending").sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}
function resolveConflict(queue, conflict_id, resolution, merged_content) {
  const item = queue.find((q) => q.id === conflict_id);
  if (!item) {
    throw new Error(`Conflict not found: ${conflict_id}`);
  }
  if (item.status !== "pending") {
    throw new Error(`Conflict already resolved: ${conflict_id}`);
  }
  item.status = "resolved";
  return {
    conflict_id,
    resolved_by: "user",
    resolution,
    resolved_at: (/* @__PURE__ */ new Date()).toISOString(),
    user_merged_content: merged_content
  };
}
function processExpiredConflicts(queue) {
  const now = /* @__PURE__ */ new Date();
  const resolutions = [];
  for (const item of queue) {
    if (item.status === "pending" && new Date(item.expires_at) <= now) {
      item.status = "auto_resolved";
      resolutions.push({
        conflict_id: item.id,
        resolved_by: "timeout",
        resolution: CONFLICT_QUEUE_CONFIG.auto_resolve_strategy,
        resolved_at: now.toISOString()
      });
    }
  }
  return resolutions;
}
function getQueueStatus(queue) {
  const pending = getPendingConflicts(queue);
  const now = /* @__PURE__ */ new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const resolvedThisWeek = queue.filter(
    (item) => item.status !== "pending" && new Date(item.created_at) >= weekStart
  ).length;
  return {
    pending_count: pending.length,
    oldest_pending_date: pending[0]?.created_at,
    next_auto_resolve_date: pending[0]?.expires_at,
    items_resolved_this_week: resolvedThisWeek,
    at_capacity: pending.length >= CONFLICT_QUEUE_CONFIG.max_items
  };
}
function formatForPresentation(item, old_node_content, old_node_date) {
  const now = /* @__PURE__ */ new Date();
  const expires = new Date(item.expires_at);
  const daysRemaining = Math.max(
    0,
    Math.ceil((expires.getTime() - now.getTime()) / (1e3 * 60 * 60 * 24))
  );
  let suggested_action;
  if (item.detection_confidence >= 0.7) {
    suggested_action = "new_is_current";
  } else if (item.detection_confidence < 0.4) {
    suggested_action = "keep_both";
  }
  return {
    conflict_id: item.id,
    entity_name: item.entity_name,
    topic: item.topic ?? "Unknown topic",
    version_a: { content: old_node_content, date: old_node_date },
    version_b: { content: item.new_content, date: item.created_at },
    suggested_action,
    confidence_in_suggestion: item.detection_confidence,
    days_until_auto_resolve: daysRemaining
  };
}
function shouldShowWeeklyPrompt(queue, config = DEFAULT_QUEUE_CONFIG) {
  if (!config.weekly_prompt_enabled) {
    return false;
  }
  const pending = getPendingConflicts(queue);
  if (pending.length === 0) {
    return false;
  }
  const today = (/* @__PURE__ */ new Date()).getDay();
  return today === config.weekly_prompt_day;
}
function getAccuracyModeConfig(mode) {
  return ACCURACY_MODE_CONFIGS[mode];
}
function shouldUseTier(tier, mode) {
  return ACCURACY_MODE_CONFIGS[mode].tiers_used.includes(tier);
}
function canAutoSupersedeTier(tier, mode) {
  return ACCURACY_MODE_CONFIGS[mode].auto_supersede_tiers.includes(tier);
}
function logDetectionEvent(event) {
  return {
    ...event,
    id: generateEventId(),
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function computeWeeklyMetrics(events, periodStart, periodEnd) {
  const periodEvents = events.filter(
    (e) => e.timestamp >= periodStart && e.timestamp <= periodEnd
  );
  const perTierAccuracy = {
    STRUCTURAL: null,
    NORMALIZED: null,
    PATTERN: null,
    CLASSIFIER: null,
    LLM: null,
    VERIFICATION: null
  };
  for (const tier of Object.keys(perTierAccuracy)) {
    const tierEvents = periodEvents.filter(
      (e) => e.tier_reached === tier && e.user_override !== void 0
    );
    if (tierEvents.length > 0) {
      const agreed = tierEvents.filter((e) => e.user_override === "agreed").length;
      perTierAccuracy[tier] = agreed / tierEvents.length;
    }
  }
  const detectedConflicts = periodEvents.filter((e) => e.resolution !== "unrelated");
  const falsePositives = detectedConflicts.filter(
    (e) => e.user_override === "disagreed" && (e.user_resolution === "keep_both" || e.resolution === "unrelated")
  ).length;
  const fpRate = detectedConflicts.length > 0 ? falsePositives / detectedConflicts.length : 0;
  const autoSuperseded = periodEvents.filter((e) => e.auto_resolved);
  const autoAgreed = autoSuperseded.filter(
    (e) => e.user_override === void 0 || e.user_override === "agreed"
  ).length;
  const autoAccuracy = autoSuperseded.length > 0 ? autoAgreed / autoSuperseded.length : 1;
  const byMode = {
    FAST: { detections: 0, accuracy: null },
    BALANCED: { detections: 0, accuracy: null },
    THOROUGH: { detections: 0, accuracy: null },
    MANUAL: { detections: 0, accuracy: null }
  };
  for (const mode of Object.keys(byMode)) {
    const modeEvents = periodEvents.filter((e) => e.accuracy_mode === mode);
    byMode[mode].detections = modeEvents.length;
    const withFeedback = modeEvents.filter((e) => e.user_override !== void 0);
    if (withFeedback.length > 0) {
      const agreed = withFeedback.filter((e) => e.user_override === "agreed").length;
      byMode[mode].accuracy = agreed / withFeedback.length;
    }
  }
  return {
    period_start: periodStart,
    period_end: periodEnd,
    per_tier_accuracy: perTierAccuracy,
    false_positive_rate: fpRate,
    false_negative_rate: 0,
    auto_supersede_accuracy: autoAccuracy,
    total_detections: periodEvents.length,
    user_resolutions: periodEvents.filter((e) => e.user_override !== void 0).length,
    by_mode: byMode
  };
}
function checkAccuracyAlerts(metrics, config = DEFAULT_SELF_IMPROVEMENT_CONFIG) {
  const alerts = [];
  for (const [tier, accuracy] of Object.entries(metrics.per_tier_accuracy)) {
    if (accuracy !== null && accuracy < config.accuracy_alert_threshold) {
      alerts.push(
        `Tier ${tier} accuracy (${(accuracy * 100).toFixed(1)}%) below threshold (${config.accuracy_alert_threshold * 100}%)`
      );
    }
  }
  if (metrics.auto_supersede_accuracy < config.auto_mode_switch_threshold) {
    alerts.push(
      `Auto-supersede accuracy (${(metrics.auto_supersede_accuracy * 100).toFixed(1)}%) below threshold - consider more conservative mode`
    );
  }
  if (metrics.false_positive_rate > 0.15) {
    alerts.push(`High false positive rate (${(metrics.false_positive_rate * 100).toFixed(1)}%)`);
  }
  return alerts;
}
function shouldTrainClassifier(trainingExamples, hasExistingModel, config = DEFAULT_SELF_IMPROVEMENT_CONFIG) {
  const train = !hasExistingModel && trainingExamples >= config.classifier_initial_train_examples;
  const retrain = hasExistingModel && trainingExamples >= config.classifier_retrain_examples;
  return { train, retrain };
}
function getTrainingData(events) {
  return events.filter(
    (e) => e.user_override !== void 0 && e.old_content !== void 0 && e.new_content !== void 0
  );
}
function getAccuracyTarget(tier) {
  return ACCURACY_TARGETS[tier];
}
function detectHistoryMode(query) {
  const lowerQuery = query.toLowerCase();
  const matched = [];
  for (const pattern of HISTORY_MODE_PATTERNS) {
    if (pattern.includes(".*")) {
      const regex = new RegExp(pattern.replace(".*", ".*"), "i");
      if (regex.test(lowerQuery)) {
        matched.push(pattern);
      }
    } else if (lowerQuery.includes(pattern.toLowerCase())) {
      matched.push(pattern);
    }
  }
  const isHistoryMode = matched.length > 0;
  return {
    is_history_mode: isHistoryMode,
    matched_patterns: matched,
    suggested_mode: isHistoryMode ? "history" : "current"
  };
}
function applySupersededCap(activation, node) {
  const isSuperseded = node.state.lifecycle === "superseded" || node.superseded_by !== void 0;
  if (!isSuperseded) {
    return activation;
  }
  return Math.min(activation, SSA_SUPERSEDED_ACTIVATION_CAP);
}
function calculateSupersededSpread(activation, isSuperseded) {
  if (!isSuperseded) {
    return activation;
  }
  return activation * SSA_SUPERSEDED_SPREAD_DECAY;
}
function injectSupersessionContext(node, supersedingContent) {
  const oldContent = node.content.body ?? node.content.title;
  return PHASE2_CONTEXT_INJECTION.superseded_context_template.replace("{old_content}", oldContent).replace("{new_content}", supersedingContent);
}
function shouldFollowSupersedesEdges(query) {
  const lowerQuery = query.toLowerCase();
  for (const pattern of PHASE2_CONTEXT_INJECTION.follow_supersedes_for) {
    if (lowerQuery.includes(pattern.toLowerCase())) {
      return true;
    }
  }
  return false;
}
function buildHistoryTimeline(chain) {
  if (chain.length === 0) {
    return "No history available.";
  }
  const lines = ["Timeline:"];
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i];
    if (!node) continue;
    const date = formatDate(node.temporal.ingestion.timestamp);
    const content = node.content.body ?? node.content.title;
    const isCurrent = i === chain.length - 1;
    lines.push(`- ${date}: ${content}${isCurrent ? " (current)" : ""}`);
  }
  return lines.join("\n");
}
function getQueryModeConfig(mode) {
  return QUERY_MODE_CONFIGS[mode];
}
function shouldIncludeSuperseded(mode) {
  return QUERY_MODE_CONFIGS[mode].include_superseded;
}
function getSupersededPenalty(mode) {
  return QUERY_MODE_CONFIGS[mode].superseded_penalty;
}
function shouldFlagSupersessionHistory(topResults) {
  for (const node of topResults) {
    if (node.superseded_by !== void 0) {
      return true;
    }
  }
  return false;
}

export { ACCURACY_MODES, ACCURACY_MODE_CONFIGS, ACCURACY_TARGETS, ATTRIBUTE_SYNONYMS, AUTO_SUPERSEDE_ACCURACY_TARGET, AccuracyMetricsSchema, AccuracyModeConfigSchema, AccuracyModeSchema, CLASSIFIER_FEW_SHOT_PROMPT, CLASSIFIER_TRAINING, CONFLICT_QUEUE_CONFIG, CONFLICT_STATUSES, CONFLICT_TYPES, CONFLICT_TYPE_RESOLUTION, ClassifierResultSchema, ConflictPresentationSchema, ConflictQueueConfigSchema, ConflictQueueItemSchema, ConflictQueueStatusSchema, ConflictStatusSchema, ConflictTypeSchema, ContradictionResolutionSchema, DEFAULT_QUEUE_CONFIG, DEFAULT_RETRIEVAL_INTEGRATION_CONFIG, DEFAULT_SELF_IMPROVEMENT_CONFIG, DELETION_CRITERIA, DETECTION_TIERS, DETECTION_TIER_METADATA, DeletionCriteriaResultSchema, DetectionContextSchema, DetectionEventLogSchema, DetectionPipelineResultSchema, DetectionTierSchema, ENTITY_NEARBY_DISTANCE, HISTORY_MODE_PATTERNS, HISTORY_MODE_SUPERSEDED_PENALTY, HistoryModeDetectionSchema, LLMDetectionOutputSchema, LLM_DETECTION_PROMPT, NormalizationResultSchema, PATTERN_CONFIDENCE_WEIGHTS, PATTERN_DISQUALIFIERS, PATTERN_TRIGGERS, PHASE2_CONTEXT_INJECTION, PatternDetectionSchema, Phase2ContextInjectionSchema, QCSHistoryModeConfigSchema, QCS_HISTORY_MODE_CONFIG, QUERY_MODES, QUERY_MODE_CONFIGS, QueryModeConfigSchema, QueryModeSchema, RCSSupersessionFlagSchema, RCS_SUPERSESSION_FLAG, RESOLUTION_STRATEGIES, ResolutionStrategySchema, RetrievalIntegrationConfigSchema, SENTIMENTS, SSASupersededConfigSchema, SSA_SUPERSEDED_ACTIVATION_CAP, SSA_SUPERSEDED_CONFIG, SSA_SUPERSEDED_SPREAD_DECAY, STORAGE_PRESSURE_THRESHOLD, SUPERSEDED_ACCESS_DECAY_MULTIPLIER, SUPERSEDED_DECAY_MULTIPLIERS, SUPERSEDED_DORMANT_DAYS, SUPERSEDED_R_THRESHOLDS, SUPERSEDED_STATES, SUPERSEDED_STATE_CONFIGS, SelfImprovementConfigSchema, SentimentSchema, StructuralDetectionSchema, SupersededStateConfigSchema, SupersededStateSchema, SupersededStateTransitionSchema, SupersessionFieldsSchema, TIER_THRESHOLDS, TYPE_DETECTION_CRITERIA, Tier3InputSchema, Tier4InputSchema, TierResultSchema, TypeClassificationSchema, USER_RESOLUTIONS, USER_RESOLUTION_DESCRIPTIONS, UserResolutionSchema, VERIFICATION_PROMPT, VerificationOutputSchema, addToConflictQueue, applySupersededCap, buildHistoryTimeline, calculatePatternConfidence, calculateSupersededSpread, canAutoSupersede, canAutoSupersedeTier, checkAccuracyAlerts, checkDeletionCriteria, checkStateTransition, classifyConflictType, computeWeeklyMetrics, createConflictQueueItem, daysSince, detectHistoryMode, determineSupersededState, formatDate, formatForPresentation, generateConflictId, generateEventId, getAccuracyModeConfig, getAccuracyTarget, getContentState, getDecayMultiplier, getEffectiveDecayMultiplier, getPendingConflicts, getQueryModeConfig, getQueueStatus, getResolutionStrategy, getRetrievalMode, getSupersededPenalty, getTrainingData, hasSentimentFlip, injectSupersessionContext, isAccuracyMode, isAutoSupersede, isConflictType, isDetectionTier, isQueryMode, isStoragePressure, isSupersededState, logDetectionEvent, processExpiredConflicts, resolveConflict, resolveSourceConflict, runTier1_5Normalization, runTier2Pattern, shouldContinueToNextTier, shouldFlagSupersessionHistory, shouldFollowSupersedesEdges, shouldIncludeSuperseded, shouldShowWeeklyPrompt, shouldTrainClassifier, shouldUseTier };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map