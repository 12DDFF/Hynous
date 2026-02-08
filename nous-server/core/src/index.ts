/**
 * @module @nous/core
 * @description Core library for Nous - the personal context API
 * @version 0.3.0
 *
 * This package implements the foundational data structures defined in:
 * @see {@link Brainstorms/Specs/storm-011} - Node Structure & Content Architecture
 * @see {@link Brainstorms/Specs/storm-004} - Storage & Graph Structure
 * @see {@link Brainstorms/Specs/storm-017} - Infrastructure Architecture
 *
 * Modules:
 * - constants: All constants, enums, and configuration values
 * - nodes: Node types, schemas, and creation utilities (UNS)
 * - blocks: Block structure for long-form content
 * - edges: Edge types and relationship management
 * - temporal: Four-type temporal model
 * - editing: Semantic anchor editing and versioning
 * - storage: Three-layer storage architecture (storm-004)
 * - tps: Temporal Parsing System (storm-004)
 * - episodes: Episode utilities with TPS metadata (storm-004)
 * - db: Database infrastructure (storm-017)
 * - sync: Sync infrastructure (storm-017)
 */

// Export constants
export * from './constants';

// Re-export all modules (storm-011)
export * from './nodes';
export * from './blocks';
export * from './edges';
export * from './temporal';
export * from './editing';

// Re-export storm-004 modules
export * from './storage';
export * from './tps';
export * from './episodes';

// Re-export storm-017 modules
export * from './db';
export * from './sync';

// Re-export storm-016 modules (Embeddings)
export * from './embeddings';

// Re-export storm-028 modules (Algorithm Parameters)
export * from './params';

// Re-export storm-005 modules (SSA Retrieval Algorithm)
export * from './ssa';

// Re-export storm-008 modules (Query Classification System)
export * from './qcs';

// Re-export storm-036 modules (Gate Filter)
export * from './gate-filter';

// Re-export storm-014 modules (Input & Ingestion Pipeline)
export * from './ingestion';

// Re-export storm-035 modules (Working Memory & Consolidation Pipeline)
export * from './working-memory';

// Re-export storm-007 modules (Forgetting & Persistence Model)
// Note: Some exports are renamed to avoid conflicts with params/ingestion modules
export {
  // Constants (renamed to avoid conflicts with ingestion)
  CONTENT_CATEGORIES as FORGETTING_CONTENT_CATEGORIES,
  FORGETTING_LIFECYCLE_STATES,
  STRENGTHENING_EVENTS,
  INITIAL_STABILITY_BY_CATEGORY,
  BASE_DIFFICULTY_BY_CATEGORY,
  STRENGTHENING_BONUSES,
  DIFFICULTY_CONFIG,
  LIFECYCLE_THRESHOLDS,
  DELETION_EXCLUSION_RULES,
  DELETION_CRITERIA,
  TRASH_CONFIG,
  P008_COMPRESSION_PROMPT_SPEC,
  DECAY_JOB_SPEC,
  FORGETTING_CONFIG,
  MAX_STRENGTH,
  DEFAULT_STRENGTH,
  // Type guards (renamed to avoid conflicts)
  isContentCategory as isForgettingContentCategory,
  isForgettingLifecycleState,
  isStrengtheningEventType,
  // Types (renamed to avoid conflicts with ingestion)
  type ContentCategory as ForgettingContentCategory,
  type ForgettingLifecycleState,
  type StrengtheningEventType,
  type DifficultyConfigType,
  type LifecycleThresholdsType,
  type DeletionExclusionRulesType,
  type DeletionCriteriaType,
  type TrashConfigType,
  type CompressionPromptSpecType,
  type DecayJobSpecType,
  type ForgettingConfigType,
  // Types (no conflicts)
  type NeuralState,
  type StrengtheningRecord,
  type StrengtheningResult,
  type DifficultyFactors,
  type ComplexityAnalysis,
  type CompressionInput,
  type CompressionResult,
  type ExclusionCheckResult,
  type DeletionCandidate,
  type TrashRecord,
  type CleanupSettings,
  type StorageMetrics,
  type StabilityUpdateResult,
  type StateTransition,
  type DecayJobResult,
  type NodeDecayInput,
  type LifecycleDetermination,
  type CreateNeuralStateOptions,
  // Schemas
  NeuralStateSchema,
  StrengtheningRecordSchema,
  StrengtheningResultSchema,
  DifficultyFactorsSchema,
  ComplexityAnalysisSchema,
  CompressionInputSchema,
  CompressionResultSchema,
  ExclusionCheckResultSchema,
  DeletionCandidateSchema,
  TrashRecordSchema,
  CleanupSettingsSchema,
  StorageMetricsSchema,
  StabilityUpdateResultSchema,
  StateTransitionSchema,
  DecayJobResultSchema,
  NodeDecayInputSchema,
  LifecycleDeterminationSchema,
  CreateNeuralStateOptionsSchema,
  // Functions (renamed to avoid conflicts with params)
  calculateRetrievability as forgettingCalculateRetrievability,
  getDecayLifecycleState as forgettingGetDecayLifecycleState,
  updateStabilityOnAccess as forgettingUpdateStabilityOnAccess,
  calculateDifficulty as forgettingCalculateDifficulty,
  // Functions (no conflicts)
  determineLifecycle,
  strengthenNode,
  analyzeComplexity,
  shouldCompress,
  shouldArchive,
  hasActiveInboundLinks,
  checkExclusionRules,
  isDeletionCandidate,
  moveToTrash,
  permanentlyDelete,
  restoreFromTrash,
  runDecayCycle,
  mapContentCategoryToNodeType,
  getInitialStabilityForCategory,
  getBaseDifficultyForCategory,
  createNeuralState,
  validateNeuralState,
  validateStrengtheningRecord,
  validateDeletionCandidate,
  validateDecayJobResult,
} from './forgetting';

// Re-export storm-006 modules (Memory Organization / Clusters)
export * from './clusters';

// Re-export storm-009 modules (Contradiction Resolution System)
export * from './contradiction';

// Re-export storm-015 modules (LLM Integration Layer)
export * from './llm';

// Re-export storm-022 modules (Security & Auth Architecture)
export * from './security';

// Re-export storm-012 modules (Adaptive Budget System)
export * from './adaptive-limits';

// Re-export storm-027 modules (Prompt Engineering System / NPL)
export * from './prompts';

// Re-export storm-030 modules (Agent Tool Specifications / ATSS)
export * from './agent-tools';

// Re-export storm-029 modules (Context Window & Chunking Strategy)
export * from './context-window';

// storm-019 Embedded AI Agent (NEAS) is available via '@nous/core/agent' subpath
// Not re-exported here due to naming conflict with security module (getOfflineCapabilities)
// Import directly: import { classifyAgentError, ... } from '@nous/core/agent'

// storm-026 Backend Infrastructure is available via '@nous/core/backend' subpath
// Not re-exported here due to intentional naming overlaps with domain-level types
// (e.g., VectorSearchOptions, Change, HealthStatus have different meanings at the adapter layer)
// Import directly: import { ServerConfig, ... } from '@nous/core/backend'
