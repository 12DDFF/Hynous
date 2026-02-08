/**
 * @module @nous/core/prompts
 * @description Interfaces and Zod schemas for all NPL prompt outputs
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-027
 * @storm Brainstorms/Infrastructure/storm-027-prompt-engineering
 *
 * Defines output schemas for all 13 NPL prompts plus shared types.
 * Every interface has a corresponding Zod schema for runtime validation.
 *
 * IMPORTANT: These types represent what the LLM outputs (raw prompt response).
 * They are NOT the same as the consumer storm's types (e.g., storm-008's
 * ClassificationResult). The calling code bridges between these types.
 *
 * @see {@link ./constants} - All constant values and enums
 * @see {@link ./intent-detection} - IDS v1.0 types
 */

import { z } from 'zod';
import {
  type NplPromptId,
  NplPromptIdSchema,
  type NplCacheStrategy,
  NplCacheStrategySchema,
  type NplErrorType,
  NplErrorTypeSchema,
  type NplQueryClassification,
  NplQueryClassificationSchema,
  type NplDisqualifierCode,
  NplDisqualifierCodeSchema,
  type NplExtractionNodeType,
  NplExtractionNodeTypeSchema,
  type NplConfidenceLevel,
  NplConfidenceLevelSchema,
  type NplContradictionRecommendation,
  NplContradictionRecommendationSchema,
  type NplContradictionRelationship,
  NplContradictionRelationshipSchema,
} from './constants';

// ============================================================
// PROMPT METADATA
// ============================================================

/**
 * Metadata attached to every NPL prompt.
 * Enables versioning, A/B testing, cache invalidation, and evolution tracking.
 *
 * @example
 * ```typescript
 * const metadata: NplPromptMetadata = {
 *   _schemaVersion: 1,
 *   id: 'P-001',
 *   name: 'Query Classification',
 *   version: '1.1.0',
 *   lastUpdated: '2026-02-05',
 *   integratesWith: ['storm-008'],
 *   testedModels: ['gemini-flash', 'gpt-4o-mini'],
 *   temperature: 0,
 *   cacheStrategy: 'global',
 * };
 * ```
 *
 * @see storm-027 v1.1 - PromptMetadata Standard
 */
export interface NplPromptMetadata {
  /** Schema version for migration support */
  _schemaVersion: number;
  /** Prompt identifier */
  id: NplPromptId;
  /** Human-readable name */
  name: string;
  /** Semantic version string */
  version: string;
  /** Last updated date (ISO) */
  lastUpdated: string;
  /** Storm integrations */
  integratesWith: string[];
  /** Models this prompt has been tested with */
  testedModels: string[];
  /** Recommended temperature */
  temperature: number;
  /** Caching strategy */
  cacheStrategy: NplCacheStrategy;
}

export const NplPromptMetadataSchema = z.object({
  _schemaVersion: z.number().int().positive(),
  id: NplPromptIdSchema,
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  lastUpdated: z.string(),
  integratesWith: z.array(z.string()),
  testedModels: z.array(z.string()),
  temperature: z.number().min(0).max(2),
  cacheStrategy: NplCacheStrategySchema,
});

// ============================================================
// PROMPT ERROR
// ============================================================

/**
 * Standard error response from any NPL prompt.
 *
 * @example
 * ```typescript
 * const error: NplPromptError = {
 *   error: true,
 *   errorType: 'MALFORMED_INPUT',
 *   errorMessage: 'Message is empty',
 *   suggestion: 'Provide a non-empty user message',
 * };
 * ```
 *
 * @see storm-027 v1.1 - Error Response Standard
 */
export interface NplPromptError {
  /** Always true for error responses */
  error: true;
  /** Error category */
  errorType: NplErrorType;
  /** Human-readable error message */
  errorMessage: string;
  /** Suggested action to resolve */
  suggestion: string;
}

export const NplPromptErrorSchema = z.object({
  error: z.literal(true),
  errorType: NplErrorTypeSchema,
  errorMessage: z.string(),
  suggestion: z.string(),
});

// ============================================================
// P-001: QUERY CLASSIFICATION OUTPUT
// ============================================================

/**
 * P-001 Query Classification output.
 * What the LLM returns when classifying a user query.
 *
 * NOTE: This is the raw LLM output. Storm-008's ClassificationResult
 * is produced AFTER processing this through the QCS pipeline.
 *
 * @example
 * ```typescript
 * const result: NplQueryClassificationResult = {
 *   classification: 'RETRIEVAL',
 *   memoryQueryScore: 0.95,
 *   directTaskScore: 0.05,
 *   contextMissingScore: 0.1,
 *   disqualifiers: [],
 *   reasoning: 'User asking about specific person and topic',
 * };
 * ```
 *
 * @see storm-008 ClassificationResult for the processed QCS output
 * @see storm-027 v1.1 P-001
 */
export interface NplQueryClassificationResult {
  /** Query classification category */
  classification: NplQueryClassification;
  /** How likely the query needs memory retrieval (0-1) */
  memoryQueryScore: number;
  /** How likely it's a standalone task (0-1) */
  directTaskScore: number;
  /** How much context appears to be missing (0-1) */
  contextMissingScore: number;
  /** Disqualifier codes that force Phase 2 */
  disqualifiers: NplDisqualifierCode[];
  /** Brief explanation of classification */
  reasoning: string;
}

export const NplQueryClassificationResultSchema = z.object({
  classification: NplQueryClassificationSchema,
  memoryQueryScore: z.number().min(0).max(1),
  directTaskScore: z.number().min(0).max(1),
  contextMissingScore: z.number().min(0).max(1),
  disqualifiers: z.array(NplDisqualifierCodeSchema),
  reasoning: z.string(),
});

// ============================================================
// ENTITY AND TEMPORAL TYPES (Shared)
// ============================================================

/**
 * Entity extracted from user message.
 */
export interface NplEntity {
  /** Entity name */
  name: string;
  /** Entity type */
  type: 'person' | 'place' | 'thing' | 'concept' | 'event' | 'organization';
}

export const NplEntitySchema = z.object({
  name: z.string().min(1),
  type: z.enum(['person', 'place', 'thing', 'concept', 'event', 'organization']),
});

/**
 * Temporal reference parsed from user message.
 */
export interface NplTemporalRef {
  /** Whether a temporal reference was found */
  hasReference: boolean;
  /** Parsed ISO date (if resolvable) */
  parsed: string | null;
  /** Original relative text (e.g., "last week") */
  relative: string | null;
}

export const NplTemporalRefSchema = z.object({
  hasReference: z.boolean(),
  parsed: z.string().nullable(),
  relative: z.string().nullable(),
});

// ============================================================
// P-002: INTENT EXTRACTION OUTPUT (v1.2)
// ============================================================

/**
 * P-002 Intent Extraction output (v1.2).
 * Extended in v2 with 10 intents, multi-intent, and retrieval mode.
 *
 * @example
 * ```typescript
 * const result: NplIntentExtractionResult = {
 *   intent: 'store',
 *   confidence: 0.95,
 *   isExplicit: true,
 *   secondaryIntent: null,
 *   secondaryConfidence: null,
 *   retrievalMode: null,
 *   multiIntentPattern: null,
 *   executionOrder: ['store'],
 *   entities: [{ name: 'Sarah', type: 'person' }],
 *   temporal: { hasReference: false, parsed: null, relative: null },
 *   saveSignal: 'explicit',
 *   actionVerbsDetected: ['remember'],
 *   reasoning: "'Remember' is explicit store verb",
 * };
 * ```
 *
 * @see storm-014 Classification interface
 * @see storm-027 v2 P-002 v1.2
 */
export interface NplIntentExtractionResult {
  /** Primary detected intent (from IDS v1.0 — 10 intents) */
  intent: string; // NplIntentType (from intent-detection.ts, avoid circular import)
  /** Confidence in primary intent (0-1) */
  confidence: number;
  /** Whether intent was explicitly stated */
  isExplicit: boolean;
  /** Secondary intent if multi-intent detected */
  secondaryIntent: string | null;
  /** Secondary intent confidence */
  secondaryConfidence: number | null;
  /** Retrieval mode for retrieve/summarize/compare */
  retrievalMode: 'direct' | 'summarize' | 'compare' | null;
  /** Multi-intent pattern name (if detected) */
  multiIntentPattern: string | null;
  /** Execution order for multi-intent */
  executionOrder: string[];
  /** Extracted entities */
  entities: NplEntity[];
  /** Temporal reference */
  temporal: NplTemporalRef;
  /** Save signal strength */
  saveSignal: 'explicit' | 'implicit' | 'none';
  /** Action verbs found in message */
  actionVerbsDetected: string[];
  /** Brief explanation */
  reasoning: string;
}

export const NplIntentExtractionResultSchema = z.object({
  intent: z.string(),
  confidence: z.number().min(0).max(1),
  isExplicit: z.boolean(),
  secondaryIntent: z.string().nullable(),
  secondaryConfidence: z.number().min(0).max(1).nullable(),
  retrievalMode: z.enum(['direct', 'summarize', 'compare']).nullable(),
  multiIntentPattern: z.string().nullable(),
  executionOrder: z.array(z.string()),
  entities: z.array(NplEntitySchema),
  temporal: NplTemporalRefSchema,
  saveSignal: z.enum(['explicit', 'implicit', 'none']),
  actionVerbsDetected: z.array(z.string()),
  reasoning: z.string(),
});

// ============================================================
// P-002C: CLARIFICATION OUTPUT
// ============================================================

/**
 * Clarification option for ambiguous intent.
 */
export interface NplClarificationOption {
  /** Display label */
  label: string;
  /** What intent this option implies */
  impliesIntent: string; // NplIntentType
}

export const NplClarificationOptionSchema = z.object({
  label: z.string().min(1),
  impliesIntent: z.string(),
});

/**
 * P-002C Intent Clarification output.
 *
 * @example
 * ```typescript
 * const result: NplClarificationResult = {
 *   clarification: 'Did you mean to save your notes or look them up?',
 *   options: [
 *     { label: 'Save my notes', impliesIntent: 'store' },
 *     { label: 'Find my notes', impliesIntent: 'retrieve' },
 *   ],
 *   fallbackIntent: 'retrieve',
 * };
 * ```
 *
 * @see storm-027 v2 P-002C
 */
export interface NplClarificationResult {
  /** Clarification question to ask user */
  clarification: string;
  /** Options to present */
  options: NplClarificationOption[];
  /** Fallback intent if user doesn't respond */
  fallbackIntent: string; // NplIntentType
}

export const NplClarificationResultSchema = z.object({
  clarification: z.string().min(1),
  options: z.array(NplClarificationOptionSchema).min(2).max(4),
  fallbackIntent: z.string(),
});

// ============================================================
// P-003: NODE EXTRACTION OUTPUT
// ============================================================

/**
 * Entity extracted during node extraction.
 */
export interface NplExtractedEntity {
  /** Entity name */
  name: string;
  /** Entity type */
  type: string;
  /** Whether this is a new entity (not in existing graph) */
  isNew: boolean;
}

export const NplExtractedEntitySchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  isNew: z.boolean(),
});

/**
 * Temporal information from extraction.
 */
export interface NplExtractionTemporal {
  /** When the event/fact occurred (ISO date) */
  occurredAt: string | null;
  /** Original temporal text */
  relativeText: string | null;
  /** Whether this is a recurring event */
  isRecurring: boolean;
}

export const NplExtractionTemporalSchema = z.object({
  occurredAt: z.string().nullable(),
  relativeText: z.string().nullable(),
  isRecurring: z.boolean(),
});

/**
 * Suggested edge from extraction.
 */
export interface NplSuggestedEdge {
  /** Target entity or concept hint */
  targetHint: string;
  /** Suggested relationship type */
  relation: string;
}

export const NplSuggestedEdgeSchema = z.object({
  targetHint: z.string().min(1),
  relation: z.string().min(1),
});

/**
 * Single extracted node from P-003.
 */
export interface NplExtractedNode {
  /** Core content to store */
  content: string;
  /** Node type classification */
  type: NplExtractionNodeType;
  /** Short title (max 50 characters) */
  title: string;
  /** Entities found in content */
  entities: NplExtractedEntity[];
  /** Temporal information */
  temporal: NplExtractionTemporal;
  /** Suggested edges to other nodes */
  suggestedEdges: NplSuggestedEdge[];
  /** Extraction confidence (0-1) */
  confidence: number;
}

export const NplExtractedNodeSchema = z.object({
  content: z.string().min(1),
  type: NplExtractionNodeTypeSchema,
  title: z.string().min(1).max(50),
  entities: z.array(NplExtractedEntitySchema),
  temporal: NplExtractionTemporalSchema,
  suggestedEdges: z.array(NplSuggestedEdgeSchema),
  confidence: z.number().min(0).max(1),
});

/**
 * P-003 Node Extraction output.
 *
 * @example
 * ```typescript
 * const result: NplNodeExtractionResult = {
 *   nodes: [{
 *     content: "Sarah's phone number is 555-1234",
 *     type: 'FACT',
 *     title: "Sarah's phone number",
 *     entities: [{ name: 'Sarah', type: 'person', isNew: false }],
 *     temporal: { occurredAt: null, relativeText: null, isRecurring: false },
 *     suggestedEdges: [{ targetHint: 'Sarah', relation: 'about_entity' }],
 *     confidence: 0.95,
 *   }],
 *   extractionNotes: 'Single fact extracted from casual mention',
 * };
 * ```
 *
 * @see storm-014 StagedNode
 * @see storm-011 NousNode
 * @see storm-027 v1.1 P-003
 */
export interface NplNodeExtractionResult {
  /** Extracted nodes */
  nodes: NplExtractedNode[];
  /** Notes about extraction decisions */
  extractionNotes: string;
}

export const NplNodeExtractionResultSchema = z.object({
  nodes: z.array(NplExtractedNodeSchema),
  extractionNotes: z.string(),
});

// ============================================================
// P-004: EDGE RELATIONSHIP OUTPUT
// ============================================================

/**
 * Detected edge relationship between nodes.
 */
export interface NplDetectedEdge {
  /** Source node ID */
  sourceNodeId: string;
  /** Target node ID */
  targetNodeId: string;
  /** Edge type (from storm-011 EDGE_TYPES) */
  edgeType: string;
  /** Relationship description */
  description: string;
  /** Suggested weight (0-1) */
  weight: number;
  /** Confidence in this edge detection (0-1) */
  confidence: number;
}

export const NplDetectedEdgeSchema = z.object({
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  edgeType: z.string().min(1),
  description: z.string(),
  weight: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});

/**
 * P-004 Edge Relationship output.
 *
 * @see storm-011 EDGE_TYPES
 * @see storm-031 edge weight calculation
 * @see storm-027 v1.1 P-004
 */
export interface NplEdgeRelationshipResult {
  /** Detected edges */
  edges: NplDetectedEdge[];
  /** Notes about relationship analysis */
  analysisNotes: string;
}

export const NplEdgeRelationshipResultSchema = z.object({
  edges: z.array(NplDetectedEdgeSchema),
  analysisNotes: z.string(),
});

// ============================================================
// P-005: ORIENT OUTPUT
// ============================================================

/**
 * Entry point selected during Orient stage.
 */
export interface NplEntryPoint {
  /** Node ID from SSA results */
  nodeId: string;
  /** Why this node was selected */
  reason: string;
  /** Expected exploration direction */
  expectedDirection: string;
}

export const NplEntryPointSchema = z.object({
  nodeId: z.string().min(1),
  reason: z.string().min(1),
  expectedDirection: z.string(),
});

/**
 * P-005 Orient output.
 *
 * NOTE: Bridge to storm-003:
 * - NplEntryPoint.nodeId → EntryPoint.node_id
 * - NplEntryPoint.expectedDirection → EntryPoint.exploration_hint
 * - Missing: EntryPoint.relevance_score (added by calling code from SSA results)
 *
 * @see storm-003 OrientResult
 * @see storm-003 EntryPoint
 * @see storm-027 v1.1 P-005
 */
export interface NplOrientResult {
  /** Selected entry points for exploration */
  entryPoints: NplEntryPoint[];
  /** Exploration strategy description */
  explorationStrategy: string;
  /** Quality assessment of concept map */
  conceptMapQuality: 'good' | 'sparse' | 'poor';
  /** Additional quality notes */
  qualityNotes: string | null;
}

export const NplOrientResultSchema = z.object({
  entryPoints: z.array(NplEntryPointSchema).min(1).max(3),
  explorationStrategy: z.string(),
  conceptMapQuality: z.enum(['good', 'sparse', 'poor']),
  qualityNotes: z.string().nullable(),
});

// ============================================================
// P-006: EXPLORE OUTPUT
// ============================================================

/**
 * Single exploration step from P-006.
 */
export interface NplExplorationStep {
  /** Node being visited */
  nodeId: string;
  /** How we got here (edge type traversed) */
  fromEdge: string;
  /** What was found at this node */
  finding: string;
  /** Should continue from this node? */
  shouldContinue: boolean;
  /** Why continue or stop */
  reason: string;
}

export const NplExplorationStepSchema = z.object({
  nodeId: z.string().min(1),
  fromEdge: z.string(),
  finding: z.string(),
  shouldContinue: z.boolean(),
  reason: z.string(),
});

/**
 * P-006 Explore output.
 *
 * NOTE: Bridge to storm-003:
 * - NplExplorationStep maps to ExplorationHop (from_node, to_node, edge_type, finding)
 * - Storm-003 wraps steps into ExplorationIteration objects
 *
 * @see storm-003 ExploreResult
 * @see storm-003 ExplorationHop
 * @see storm-027 v1.1 P-006
 */
export interface NplExploreResult {
  /** Exploration steps taken */
  steps: NplExplorationStep[];
  /** All findings collected */
  findings: string[];
  /** Whether more exploration is recommended */
  shouldContinueExploring: boolean;
  /** Reason for stopping (if applicable) */
  stopReason: string | null;
}

export const NplExploreResultSchema = z.object({
  steps: z.array(NplExplorationStepSchema),
  findings: z.array(z.string()),
  shouldContinueExploring: z.boolean(),
  stopReason: z.string().nullable(),
});

// ============================================================
// P-007: SYNTHESIZE OUTPUT
// ============================================================

/**
 * Source reference in synthesized answer.
 */
export interface NplSourceRef {
  /** Node ID that contributed to the answer */
  nodeId: string;
  /** Why this source was used */
  whyUsed: string;
}

export const NplSourceRefSchema = z.object({
  nodeId: z.string().min(1),
  whyUsed: z.string().min(1),
});

/**
 * P-007 Synthesize output.
 *
 * NOTE: Bridge to storm-003:
 * - confidence (string) → Use NPL_CONFIDENCE_LEVEL_SCORES for numeric conversion
 * - confidenceScore (number) → Maps directly to SynthesizeResult.confidence
 * - answerCompleteness → Maps to SynthesizeResult.answer_completeness
 * - sources → Need to add 'title' and 'supports' and 'relevance' for SynthesisSource
 *
 * @see storm-003 SynthesizeResult (confidence: number 0-1)
 * @see storm-027 v1.1 P-007
 */
export interface NplSynthesizeResult {
  /** The synthesized answer */
  answer: string;
  /** Sources that contributed to the answer */
  sources: NplSourceRef[];
  /** Confidence level (string — what LLM outputs) */
  confidence: NplConfidenceLevel;
  /** Confidence score (0-1 — numeric for storm-003 bridge) */
  confidenceScore: number;
  /** Why this confidence level */
  confidenceReason: string;
  /** How complete is the answer */
  answerCompleteness: 'complete' | 'partial' | 'uncertain';
  /** Suggested follow-up questions */
  followUpSuggestions: string[];
  /** Information gaps identified */
  informationGaps: string[];
}

export const NplSynthesizeResultSchema = z.object({
  answer: z.string().min(1),
  sources: z.array(NplSourceRefSchema),
  confidence: NplConfidenceLevelSchema,
  confidenceScore: z.number().min(0).max(1),
  confidenceReason: z.string(),
  answerCompleteness: z.enum(['complete', 'partial', 'uncertain']),
  followUpSuggestions: z.array(z.string()),
  informationGaps: z.array(z.string()),
});

// ============================================================
// P-009: AGENT PLAN OUTPUT
// ============================================================

/**
 * Single step in agent execution plan.
 */
export interface NplAgentStep {
  /** Step number */
  step: number;
  /** Tool to use */
  tool: string;
  /** Tool parameters */
  params: Record<string, unknown>;
  /** Why this step is needed */
  reason: string;
}

export const NplAgentStepSchema = z.object({
  step: z.number().int().positive(),
  tool: z.string().min(1),
  params: z.record(z.unknown()),
  reason: z.string(),
});

/**
 * P-009 Agent Reasoning output.
 *
 * @see storm-019 (brainstorm) - Agent tool specs
 * @see storm-027 v1.1 P-009
 */
export interface NplAgentPlan {
  /** Understanding of user's request */
  understanding: string;
  /** Execution plan */
  plan: NplAgentStep[];
  /** Whether user confirmation is needed before executing */
  needsConfirmation: boolean;
  /** Why confirmation is needed (if applicable) */
  confirmationReason: string | null;
  /** Alternative interpretation of the request */
  alternativeInterpretation: string | null;
}

export const NplAgentPlanSchema = z.object({
  understanding: z.string().min(1),
  plan: z.array(NplAgentStepSchema).min(1),
  needsConfirmation: z.boolean(),
  confirmationReason: z.string().nullable(),
  alternativeInterpretation: z.string().nullable(),
});

// ============================================================
// P-010: CONTRADICTION DETECTION OUTPUT
// ============================================================

/**
 * P-010 Contradiction Detection output.
 *
 * NOTE: This type mirrors storm-009's LLMDetectionOutput exactly.
 * The authoritative prompt is defined in storm-009 detection-pipeline.ts.
 *
 * @see storm-009 LLMDetectionOutput
 * @see storm-009 LLM_DETECTION_PROMPT
 */
export interface NplContradictionDetectionResult {
  /** Relationship between old and new information */
  relationship: NplContradictionRelationship;
  /** Confidence in this assessment (0-1) */
  confidence: number;
  /** Brief explanation */
  reasoning: string;
  /** Which information is current */
  whichIsCurrent: 'old' | 'new' | 'both' | 'unclear';
  /** Whether both could be true simultaneously */
  bothCouldBeTrue: boolean;
  /** Whether this is time-dependent */
  isTimeDependent: boolean;
  /** Whether user input is required regardless of confidence */
  needsUserInput: boolean;
}

export const NplContradictionDetectionResultSchema = z.object({
  relationship: NplContradictionRelationshipSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  whichIsCurrent: z.enum(['old', 'new', 'both', 'unclear']),
  bothCouldBeTrue: z.boolean(),
  isTimeDependent: z.boolean(),
  needsUserInput: z.boolean(),
});

// ============================================================
// P-010B: VERIFICATION OUTPUT
// ============================================================

/**
 * P-010B Contradiction Verification output.
 *
 * NOTE: This type mirrors storm-009's VerificationOutput exactly.
 * The authoritative prompt is defined in storm-009 detection-pipeline.ts.
 *
 * @see storm-009 VerificationOutput
 * @see storm-009 VERIFICATION_PROMPT
 */
export interface NplVerificationResult {
  /** Whether auto-supersession should proceed */
  shouldSupersede: boolean;
  /** Confidence in this recommendation (0-1) */
  confidence: number;
  /** Concerns found (empty if none) */
  concerns: string[];
  /** Final recommendation */
  recommendation: NplContradictionRecommendation;
}

export const NplVerificationResultSchema = z.object({
  shouldSupersede: z.boolean(),
  confidence: z.number().min(0).max(1),
  concerns: z.array(z.string()),
  recommendation: NplContradictionRecommendationSchema,
});

// ============================================================
// P-011: MEMORY COMPRESSION OUTPUT
// ============================================================

/**
 * P-011 Memory Compression output.
 *
 * @see storm-007 - Forgetting Model (two-stage compression)
 * @see storm-027 v1.1 P-011
 */
export interface NplCompressionResult {
  /** Compressed summary content */
  summary: string;
  /** Summary title */
  title: string;
  /** Key points preserved */
  keyPoints: string[];
  /** Number of source nodes compressed */
  sourceCount: number;
  /** Timeframe covered */
  timeframe: string;
  /** Topic of compressed memories */
  topic: string;
  /** Related concepts count */
  relatedConceptsCount: number;
}

export const NplCompressionResultSchema = z.object({
  summary: z.string().min(1),
  title: z.string().min(1),
  keyPoints: z.array(z.string()).min(1),
  sourceCount: z.number().int().positive(),
  timeframe: z.string(),
  topic: z.string(),
  relatedConceptsCount: z.number().int().nonnegative(),
});

// ============================================================
// P-008: CONTEXT CUSTOMIZATION
// ============================================================

/**
 * Terminology entry for context customization.
 */
export interface NplTermEntry {
  /** Term to define */
  term: string;
  /** What the term means in this context */
  expansion: string;
}

export const NplTermEntrySchema = z.object({
  term: z.string().min(1),
  expansion: z.string().min(1),
});

/**
 * Context customization for P-008 dynamic injection.
 * Injected into the {{CONTEXT_SPACE_CUSTOMIZATION}} section of P-008.
 *
 * @see storm-020 (brainstorm) - Context Preferences
 * @see storm-027 v1.1 P-008 customization
 */
export interface NplContextCustomization {
  /** Response tone */
  tone: 'formal' | 'casual' | 'neutral';
  /** Response verbosity */
  verbosity: 'concise' | 'detailed' | 'adaptive';
  /** Retrieval scope for this context */
  retrievalScope: 'all' | 'this_only';
  /** Context space name (if applicable) */
  contextName: string | null;
  /** Custom terminology */
  terminology: NplTermEntry[] | null;
}

export const NplContextCustomizationSchema = z.object({
  tone: z.enum(['formal', 'casual', 'neutral']),
  verbosity: z.enum(['concise', 'detailed', 'adaptive']),
  retrievalScope: z.enum(['all', 'this_only']),
  contextName: z.string().nullable(),
  terminology: z.array(NplTermEntrySchema).nullable(),
});

// ============================================================
// PROMPT TEMPLATE DEFINITION
// ============================================================

/**
 * Complete prompt template definition.
 * Used by the prompt registry to store and retrieve prompts.
 */
export interface NplPromptTemplate {
  /** Prompt metadata */
  metadata: NplPromptMetadata;
  /** System message (the prompt itself) */
  systemMessage: string;
  /** User message template with {{placeholders}} */
  userTemplate: string;
  /** Few-shot examples */
  examples: NplPromptExample[];
}

export const NplPromptTemplateSchema = z.object({
  metadata: NplPromptMetadataSchema,
  systemMessage: z.string().min(1),
  userTemplate: z.string().min(1),
  examples: z.array(z.object({
    input: z.string(),
    output: z.string(),
  })),
});

/**
 * Few-shot example for a prompt.
 */
export interface NplPromptExample {
  /** Example input (user message) */
  input: string;
  /** Expected output (JSON string) */
  output: string;
}

export const NplPromptExampleSchema = z.object({
  input: z.string(),
  output: z.string(),
});

// ============================================================
// UTILITY FUNCTION SIGNATURES
// ============================================================

/**
 * Convert NplConfidenceLevel to numeric score (0-1).
 * Used to bridge NPL string levels to storm-003's numeric confidence.
 *
 * @param level - Confidence level string
 * @returns Numeric score: HIGH=0.9, MEDIUM=0.6, LOW=0.3
 *
 * @see storm-003 SynthesizeResult.confidence (number 0-1)
 */
export function nplConfidenceLevelToScore(level: NplConfidenceLevel): number {
  const scores: Record<NplConfidenceLevel, number> = {
    HIGH: 0.9,
    MEDIUM: 0.6,
    LOW: 0.3,
  };
  return scores[level];
}

/**
 * Convert numeric score to NplConfidenceLevel.
 *
 * @param score - Numeric confidence (0-1)
 * @returns Confidence level: >= 0.75 = HIGH, >= 0.45 = MEDIUM, else LOW
 */
export function nplScoreToConfidenceLevel(score: number): NplConfidenceLevel {
  if (score >= 0.75) return 'HIGH';
  if (score >= 0.45) return 'MEDIUM';
  return 'LOW';
}

/**
 * Build context customization string for P-008 injection.
 *
 * @param preferences - User's context preferences
 * @returns Formatted string for {{CONTEXT_SPACE_CUSTOMIZATION}} injection
 *
 * @see storm-027 v1.1 P-008 context customization
 */
export function nplBuildContextCustomization(preferences: NplContextCustomization): string {
  const parts: string[] = [];

  // Tone instructions
  if (preferences.tone === 'formal') {
    parts.push('TONE: Professional and precise. Use complete sentences. Avoid contractions. Be thorough in explanations.');
  } else if (preferences.tone === 'casual') {
    parts.push('TONE: Friendly and conversational. Contractions are fine. Keep things simple and approachable.');
  }
  // neutral = no tone override needed

  // Verbosity instructions
  if (preferences.verbosity === 'concise') {
    parts.push('VERBOSITY: Be brief. Bullet points preferred. Max 2-3 sentences for simple questions. Only elaborate if asked.');
  } else if (preferences.verbosity === 'detailed') {
    parts.push('VERBOSITY: Be thorough. Provide context and examples. Use headers for complex answers. Explain your reasoning.');
  }
  // adaptive = no verbosity override needed

  // Retrieval scope
  if (preferences.retrievalScope === 'this_only' && preferences.contextName) {
    parts.push(`SCOPE: Only search within the "${preferences.contextName}" context space.`);
  }

  // Custom terminology
  if (preferences.terminology && preferences.terminology.length > 0) {
    parts.push('TERMINOLOGY:');
    for (const entry of preferences.terminology) {
      parts.push(`- "${entry.term}" means "${entry.expansion}"`);
    }
  }

  return parts.join('\n');
}

/**
 * Check if auto-supersede conditions are met.
 * Implements the two-pass threshold check from storm-009 v2.
 *
 * @param tier3Result - P-010 output
 * @param tier4Result - P-010B output
 * @returns True if all auto-supersede conditions are met
 *
 * @see storm-009 canAutoSupersede
 */
export function nplShouldAutoSupersede(
  tier3Result: NplContradictionDetectionResult,
  tier4Result: NplVerificationResult
): boolean {
  return (
    tier3Result.confidence >= 0.8 &&
    tier3Result.relationship === 'contradicts' &&
    tier4Result.shouldSupersede &&
    tier4Result.confidence >= 0.7 &&
    tier4Result.concerns.length === 0
  );
}
