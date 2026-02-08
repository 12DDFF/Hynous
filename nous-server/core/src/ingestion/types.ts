/**
 * @module @nous/core/ingestion/types
 * @description All interfaces and Zod schemas for storm-014 Input & Ingestion Pipeline
 * @version 1.0.0
 * @spec Specs/Phase-4-Memory-Lifecycle/storm-014
 * @storm Brainstorms/Infrastructure/storm-014-input-ingestion
 */

import { z } from 'zod';
import {
  INPUT_SOURCES,
  INPUT_MODES,
  CLASSIFICATION_INTENTS,
  SAVE_SIGNALS,
  CONTENT_TYPES,
  COMPLEXITY_LEVELS,
  CONTENT_CATEGORIES,
  PROCESSING_ACTIONS,
  HANDLER_TYPES,
  INGESTION_DEFAULTS,
  type InputSource,
  type InputMode,
  type ClassificationIntent,
  type SaveSignal,
  type ContentType,
  type ComplexityLevel,
  type ContentCategory,
  type ProcessingAction,
  type HandlerType,
  type ActionVerbCategory,
} from './constants';

// ============================================================
// ATTACHMENT
// ============================================================

export interface Attachment {
  id: string;
  mimeType: string;
  fileName?: string;
  size?: number;
  url?: string;
  extractedText?: string;
}

export const AttachmentSchema = z.object({
  id: z.string(),
  mimeType: z.string(),
  fileName: z.string().optional(),
  size: z.number().optional(),
  url: z.string().optional(),
  extractedText: z.string().optional(),
});

// ============================================================
// CONVERSATION MESSAGE
// ============================================================

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export const ConversationMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.date(),
});

// ============================================================
// USER BEHAVIOR MODEL
// ============================================================

export interface UserBehaviorModel {
  userId: string;
  typicalSaveRate: number;
  promptResponseRate: number;
  dismissedPrompts: number;
  contentPreferences: {
    alwaysSave: string[];
    neverSave: string[];
  };
  currentSession: {
    promptsShown: number;
    messagesSincePrompt: number;
  };
  lastUpdated: Date;
}

export const UserBehaviorModelSchema = z.object({
  userId: z.string(),
  typicalSaveRate: z.number().min(0).max(1),
  promptResponseRate: z.number().min(0).max(1),
  dismissedPrompts: z.number().min(0),
  contentPreferences: z.object({
    alwaysSave: z.array(z.string()),
    neverSave: z.array(z.string()),
  }),
  currentSession: z.object({
    promptsShown: z.number().min(0),
    messagesSincePrompt: z.number().min(0),
  }),
  lastUpdated: z.date(),
});

// ============================================================
// INGEST OPTIONS
// ============================================================

export interface IngestOptions {
  autoSave?: boolean;
  forceSave?: boolean;
  skipClassification?: boolean;
  priority?: 'high' | 'normal' | 'low';
  mode?: InputMode;
  contentCategory?: ContentCategory;
}

export const IngestOptionsSchema = z.object({
  autoSave: z.boolean().optional(),
  forceSave: z.boolean().optional(),
  skipClassification: z.boolean().optional(),
  priority: z.enum(['high', 'normal', 'low']).optional(),
  mode: z.enum(INPUT_MODES).optional(),
  contentCategory: z.enum(CONTENT_CATEGORIES).optional(),
});

// ============================================================
// INPUT ENVELOPE
// ============================================================

export interface InputEnvelope {
  id: string;
  timestamp: Date;
  source: InputSource;
  mode: InputMode;
  raw: unknown;
  normalized: {
    text: string;
    metadata: Record<string, unknown>;
    attachments?: Attachment[];
  };
  context: {
    sessionId: string;
    userId: string;
    conversationHistory: ConversationMessage[];
    userBehavior?: UserBehaviorModel;
  };
  options?: IngestOptions;
}

export const InputEnvelopeSchema = z.object({
  id: z.string(),
  timestamp: z.date(),
  source: z.enum(INPUT_SOURCES),
  mode: z.enum(INPUT_MODES),
  raw: z.unknown(),
  normalized: z.object({
    text: z.string(),
    metadata: z.record(z.unknown()),
    attachments: z.array(AttachmentSchema).optional(),
  }),
  context: z.object({
    sessionId: z.string(),
    userId: z.string(),
    conversationHistory: z.array(ConversationMessageSchema),
    userBehavior: UserBehaviorModelSchema.optional(),
  }),
  options: IngestOptionsSchema.optional(),
});

// ============================================================
// DETECTED ACTION VERB
// ============================================================

export interface DetectedActionVerb {
  category: ActionVerbCategory;
  matched: string;
  position: number;
}

export const DetectedActionVerbSchema = z.object({
  category: z.enum(['review', 'save', 'ambiguous']),
  matched: z.string(),
  position: z.number(),
});

// ============================================================
// CLASSIFICATION
// ============================================================

export interface Classification {
  intent: ClassificationIntent;
  saveSignal: SaveSignal;
  contentType: ContentType;
  complexity: ComplexityLevel;
  confidence: number;
  contentCategory: ContentCategory;
  actionVerb?: DetectedActionVerb;
  thoughtPath: string[];
  gateResult?: unknown; // GateFilterResult from storm-036
  classifiedBy: 'fast_rules' | 'action_verbs' | 'llm' | 'user_learning';
}

export const ClassificationSchema = z.object({
  intent: z.enum(CLASSIFICATION_INTENTS),
  saveSignal: z.enum(SAVE_SIGNALS),
  contentType: z.enum(CONTENT_TYPES),
  complexity: z.enum(COMPLEXITY_LEVELS),
  confidence: z.number().min(0).max(1),
  contentCategory: z.enum(CONTENT_CATEGORIES),
  actionVerb: DetectedActionVerbSchema.optional(),
  thoughtPath: z.array(z.string()),
  gateResult: z.unknown().optional(),
  classifiedBy: z.enum(['fast_rules', 'action_verbs', 'llm', 'user_learning']),
});

// ============================================================
// ROUTE HANDLER
// ============================================================

export interface RouteHandler {
  handler: HandlerType;
  confidence: number;
  reason: string;
}

export const RouteHandlerSchema = z.object({
  handler: z.enum(HANDLER_TYPES),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

// ============================================================
// STAGED NODE
// ============================================================

export interface StagedNode {
  stagingId: string;
  nodeType: string;
  title: string;
  body: string;
  contentCategory: ContentCategory;
  extractionConfidence: number;
  provenance: {
    sourceType: 'extraction' | 'manual' | 'import';
    inputId: string;
    sessionId: string;
    timestamp: Date;
  };
  parentId?: string;
  suggestedEdges?: Array<{
    targetId: string;
    edgeType: string;
    strength: number;
  }>;
  metadata: Record<string, unknown>;
}

export const StagedNodeSchema = z.object({
  stagingId: z.string(),
  nodeType: z.string(),
  title: z.string(),
  body: z.string(),
  contentCategory: z.enum(CONTENT_CATEGORIES),
  extractionConfidence: z.number().min(0).max(1),
  provenance: z.object({
    sourceType: z.enum(['extraction', 'manual', 'import']),
    inputId: z.string(),
    sessionId: z.string(),
    timestamp: z.date(),
  }),
  parentId: z.string().optional(),
  suggestedEdges: z.array(z.object({
    targetId: z.string(),
    edgeType: z.string(),
    strength: z.number().min(0).max(1),
  })).optional(),
  metadata: z.record(z.unknown()),
});

// ============================================================
// PROCESS RESULT
// ============================================================

export interface ProcessResult {
  action: ProcessingAction;
  stagedNodes?: StagedNode[];
  response?: string;
  promptedUser?: boolean;
  userResponse?: 'save' | 'discard' | 'pending';
  metadata: {
    handler: HandlerType;
    durationMs: number;
    errors?: string[];
  };
}

export const ProcessResultSchema = z.object({
  action: z.enum(PROCESSING_ACTIONS),
  stagedNodes: z.array(StagedNodeSchema).optional(),
  response: z.string().optional(),
  promptedUser: z.boolean().optional(),
  userResponse: z.enum(['save', 'discard', 'pending']).optional(),
  metadata: z.object({
    handler: z.enum(HANDLER_TYPES),
    durationMs: z.number().min(0),
    errors: z.array(z.string()).optional(),
  }),
});

// ============================================================
// THOUGHT PATH
// ============================================================

export interface ThoughtPath {
  nodesAccessed: string[];
  nodesCreated: string[];
  nodesUpdated: string[];
  confidenceScores: number[];
  timestamp: Date;
}

export const ThoughtPathSchema = z.object({
  nodesAccessed: z.array(z.string()),
  nodesCreated: z.array(z.string()),
  nodesUpdated: z.array(z.string()),
  confidenceScores: z.array(z.number()),
  timestamp: z.date(),
});

// ============================================================
// COMMIT RESULT
// ============================================================

export interface CommitResult {
  created: string[];
  updated: string[];
  linked: string[];
  thoughtPath: ThoughtPath;
  timestamp: Date;
}

export const CommitResultSchema = z.object({
  created: z.array(z.string()),
  updated: z.array(z.string()),
  linked: z.array(z.string()),
  thoughtPath: ThoughtPathSchema,
  timestamp: z.date(),
});

// ============================================================
// INGEST RESULT
// ============================================================

export interface IngestResult {
  inputId: string;
  classification: Classification;
  action: ProcessingAction;
  nodes?: string[];
  thoughtPath: ThoughtPath;
  warnings?: string[];
  processingTimeMs: number;
}

export const IngestResultSchema = z.object({
  inputId: z.string(),
  classification: ClassificationSchema,
  action: z.enum(PROCESSING_ACTIONS),
  nodes: z.array(z.string()).optional(),
  thoughtPath: ThoughtPathSchema,
  warnings: z.array(z.string()).optional(),
  processingTimeMs: z.number().min(0),
});

// ============================================================
// DOCUMENT CHUNK
// ============================================================

export interface DocumentChunk {
  id: string;
  sequence: number;
  content: string;
  charCount: number;
  heading?: string;
  headingLevel?: number;
  parentChunkId?: string;
  overlapStart?: string;
  overlapEnd?: string;
  splitMethod: 'structural' | 'semantic' | 'size_limit';
}

export const DocumentChunkSchema = z.object({
  id: z.string(),
  sequence: z.number().min(0),
  content: z.string(),
  charCount: z.number().min(0),
  heading: z.string().optional(),
  headingLevel: z.number().min(1).max(6).optional(),
  parentChunkId: z.string().optional(),
  overlapStart: z.string().optional(),
  overlapEnd: z.string().optional(),
  splitMethod: z.enum(['structural', 'semantic', 'size_limit']),
});

// ============================================================
// PIPELINE EVENT
// ============================================================

export interface PipelineEvent {
  type:
    | 'pipeline:stage'
    | 'pipeline:classify'
    | 'pipeline:route'
    | 'node:access'
    | 'node:create'
    | 'node:update'
    | 'commit:complete';
  timestamp: Date;
  payload: Record<string, unknown>;
}

export const PipelineEventSchema = z.object({
  type: z.enum([
    'pipeline:stage',
    'pipeline:classify',
    'pipeline:route',
    'node:access',
    'node:create',
    'node:update',
    'commit:complete',
  ]),
  timestamp: z.date(),
  payload: z.record(z.unknown()),
});

// ============================================================
// STREAM OPTIONS
// ============================================================

export interface StreamOptions {
  bufferWindowMs?: number;
  silenceTriggerMs?: number;
  maxAccumulationMs?: number;
  contentCategory?: ContentCategory;
  autoExtractOnSilence?: boolean;
}

export const StreamOptionsSchema = z.object({
  bufferWindowMs: z.number().min(1000).optional(),
  silenceTriggerMs: z.number().min(500).optional(),
  maxAccumulationMs: z.number().min(60000).optional(),
  contentCategory: z.enum(CONTENT_CATEGORIES).optional(),
  autoExtractOnSilence: z.boolean().optional(),
});

// ============================================================
// INGESTION STREAM
// ============================================================

export interface IngestionStream {
  id: string;
  status: 'active' | 'paused' | 'closed';
  addChunk(audio: ArrayBuffer): void;
  signalSilence(): void;
  getAccumulated(): string;
  forceExtract(): Promise<IngestResult>;
  pause(): void;
  resume(): void;
  close(): Promise<IngestResult[]>;
  on(event: 'transcript', handler: (text: string) => void): void;
  on(event: 'extract', handler: (result: IngestResult) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
}

// ============================================================
// INGESTION CONFIG
// ============================================================

export interface IngestionConfig {
  gateFilterEnabled: boolean;
  userLearningEnabled: boolean;
  defaultContentCategory: ContentCategory;
  thoughtPathEnabled: boolean;
  intraBatchDedupe: boolean;
  dedupeSimilarity: number;
  defaultLanguage: string;
}

export const IngestionConfigSchema = z.object({
  gateFilterEnabled: z.boolean().default(INGESTION_DEFAULTS.gate_filter_enabled),
  userLearningEnabled: z.boolean().default(INGESTION_DEFAULTS.user_learning_enabled),
  defaultContentCategory: z.enum(CONTENT_CATEGORIES).default(INGESTION_DEFAULTS.default_content_category),
  thoughtPathEnabled: z.boolean().default(INGESTION_DEFAULTS.thought_path_enabled),
  intraBatchDedupe: z.boolean().default(INGESTION_DEFAULTS.intra_batch_dedupe),
  dedupeSimilarity: z.number().min(0).max(1).default(INGESTION_DEFAULTS.dedupe_similarity),
  defaultLanguage: z.string().default(INGESTION_DEFAULTS.default_language),
});

// ============================================================
// RE-EXPORTS
// ============================================================

// Type re-exports are handled by index.ts via export * from './constants'
