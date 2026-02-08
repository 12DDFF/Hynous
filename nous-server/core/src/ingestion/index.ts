/**
 * @module @nous/core/ingestion
 * @description Input & Ingestion Pipeline for storm-014
 * @version 1.0.0
 * @spec Specs/Phase-4-Memory-Lifecycle/storm-014
 * @storm Brainstorms/Infrastructure/storm-014-input-ingestion
 *
 * 6-Stage Pipeline: RECEIVE → CLASSIFY → ROUTE → PROCESS → STAGE → COMMIT
 */

import { nanoid } from 'nanoid';
import { gateFilter, type GateFilterResult } from '../gate-filter';
import {
  REVIEW_VERBS,
  SAVE_VERBS,
  AMBIGUOUS_VERBS,
  ADAPTIVE_THRESHOLDS,
  PROMPT_LIMITS,
  CHUNK_LIMITS,
  INGESTION_DEFAULTS,
  FAST_RULE_PATTERNS,
  type InputSource,
  type ComplexityLevel,
  type ContentCategory,
} from './constants';

import {
  type Attachment,
  type ConversationMessage,
  type UserBehaviorModel,
  type IngestOptions,
  type InputEnvelope,
  type DetectedActionVerb,
  type Classification,
  type RouteHandler,
  type StagedNode,
  type ProcessResult,
  type ThoughtPath,
  type CommitResult,
  type IngestResult,
  type DocumentChunk,
  type StreamOptions,
  type IngestionStream,
  type IngestionConfig,
} from './types';

// ============================================================
// ID GENERATION
// ============================================================

function generateId(prefix: string = ''): string {
  return prefix ? `${prefix}_${nanoid(12)}` : nanoid(12);
}

// ============================================================
// STAGE 1: RECEIVE
// ============================================================

/**
 * Creates a normalized InputEnvelope from raw input.
 */
export function createInputEnvelope(
  source: InputSource,
  raw: unknown,
  context: {
    sessionId: string;
    userId: string;
    conversationHistory: ConversationMessage[];
    userBehavior?: UserBehaviorModel;
  },
  options?: IngestOptions
): InputEnvelope {
  const id = generateId('inp');
  const timestamp = new Date();
  const mode = options?.mode ?? 'normal';

  const normalized = normalizeInput(source, raw);

  return {
    id,
    timestamp,
    source,
    mode,
    raw,
    normalized,
    context,
    options,
  };
}

function normalizeInput(
  source: InputSource,
  raw: unknown
): { text: string; metadata: Record<string, unknown>; attachments?: Attachment[] } {
  switch (source) {
    case 'chat':
      return {
        text: typeof raw === 'string' ? raw.trim() : String(raw).trim(),
        metadata: { source: 'chat' },
      };

    case 'file':
      const fileInput = raw as { fileName?: string; mimeType?: string; content?: string } | undefined;
      return {
        text: fileInput?.content ?? '',
        metadata: {
          source: 'file',
          fileName: fileInput?.fileName,
          mimeType: fileInput?.mimeType,
        },
      };

    case 'voice':
      return {
        text: typeof raw === 'string' ? raw.trim() : '',
        metadata: { source: 'voice', whisperProcessed: true },
      };

    case 'api':
      // Handle both plain string and object with content/text properties
      if (typeof raw === 'string') {
        return {
          text: raw.trim(),
          metadata: { source: 'api' },
        };
      }
      const apiInput = raw as { content?: string; text?: string; metadata?: Record<string, unknown> } | undefined;
      return {
        text: (apiInput?.content ?? apiInput?.text ?? '').trim(),
        metadata: { source: 'api', ...(apiInput?.metadata ?? {}) },
      };

    case 'stream':
      return {
        text: typeof raw === 'string' ? raw.trim() : '',
        metadata: { source: 'stream', isBuffered: true },
      };

    default:
      return {
        text: String(raw).trim(),
        metadata: { source },
      };
  }
}

// ============================================================
// STAGE 2: CLASSIFY
// ============================================================

/**
 * Main classification function - hybrid system.
 */
export async function classifyInput(
  envelope: InputEnvelope,
  config?: Partial<IngestionConfig>
): Promise<Classification> {
  const thoughtPath: string[] = [];
  // Disable gate filter for API source by default (API content should be classified, not rejected)
  const gateFilterEnabled = (config?.gateFilterEnabled ?? INGESTION_DEFAULTS.gate_filter_enabled)
    && envelope.source !== 'api';

  // Step 0: Gate Filter (only for non-API sources)
  let gateResult: GateFilterResult | undefined;
  if (gateFilterEnabled) {
    gateResult = gateFilter({
      source: envelope.source === 'stream' ? 'chat' : envelope.source,
      normalized: { text: envelope.normalized.text },
      metadata: {
        language: envelope.normalized.metadata.language as string | undefined,
        whisperProcessed: envelope.normalized.metadata.whisperProcessed as boolean | undefined,
        isManualNote: envelope.options?.forceSave,
      },
      options: {
        forceSave: envelope.options?.forceSave,
      },
      context: {
        userId: envelope.context.userId,
        sessionId: envelope.context.sessionId,
      },
    });

    if (gateResult.decision === 'REJECT') {
      return {
        intent: 'noise',
        saveSignal: 'none',
        contentType: 'mixed',
        complexity: 'atomic',
        confidence: gateResult.confidence,
        contentCategory: 'general',
        thoughtPath,
        gateResult,
        classifiedBy: 'fast_rules',
      };
    }
  }

  // Step 1: Fast rules (<1ms)
  const fastResult = fastRuleClassify(envelope.normalized.text);
  // Return early if fast rules matched with reasonable confidence
  // Query, social, command intents are definitive; content needs further processing
  if (fastResult.confidence >= 0.85 && fastResult.intent !== 'content') {
    return {
      ...fastResult,
      thoughtPath,
      gateResult,
      classifiedBy: 'fast_rules',
    };
  }
  // Explicit save is also definitive
  if (fastResult.confidence >= 0.9 && fastResult.saveSignal === 'explicit') {
    return {
      ...fastResult,
      thoughtPath,
      gateResult,
      classifiedBy: 'fast_rules',
    };
  }

  // Step 2: User learning (before action verbs - user preferences are more specific)
  if (envelope.context.userBehavior && config?.userLearningEnabled !== false) {
    const learningResult = classifyByUserLearning(envelope);
    if (learningResult && learningResult.confidence > 0.8) {
      return {
        ...learningResult,
        thoughtPath,
        gateResult,
        classifiedBy: 'user_learning',
      };
    }
  }

  // Step 3: Action verb detection
  const actionVerb = detectActionVerb(envelope.normalized.text);
  if (actionVerb) {
    const actionResult = classifyByActionVerb(actionVerb);
    if (actionResult.confidence > 0.85) {
      return {
        ...actionResult,
        actionVerb,
        thoughtPath,
        gateResult,
        classifiedBy: 'action_verbs',
      };
    }
  }

  // Step 4: LLM fallback (stub)
  return {
    intent: 'content',
    saveSignal: 'implicit',
    contentType: 'mixed',
    complexity: detectComplexity(envelope.normalized.text),
    confidence: 0.7,
    contentCategory: config?.defaultContentCategory ?? 'general',
    thoughtPath,
    gateResult,
    classifiedBy: 'llm',
  };
}

/**
 * Fast rule classification (<1ms).
 */
export function fastRuleClassify(text: string): Omit<Classification, 'thoughtPath' | 'classifiedBy' | 'gateResult'> {
  const trimmed = text.trim().toLowerCase();

  // Check explicit save patterns
  for (const pattern of FAST_RULE_PATTERNS.explicit_save) {
    if (pattern.test(trimmed)) {
      return {
        intent: 'content',
        saveSignal: 'explicit',
        contentType: 'mixed',
        complexity: 'atomic',
        confidence: 0.95,
        contentCategory: 'general',
      };
    }
  }

  // Check question patterns
  for (const pattern of FAST_RULE_PATTERNS.question) {
    if (pattern.test(trimmed)) {
      return {
        intent: 'query',
        saveSignal: 'none',
        contentType: 'question',
        complexity: 'atomic',
        confidence: 0.9,
        contentCategory: 'general',
      };
    }
  }

  // Check social patterns
  for (const pattern of FAST_RULE_PATTERNS.social) {
    if (pattern.test(trimmed)) {
      return {
        intent: 'conversation',
        saveSignal: 'none',
        contentType: 'mixed',
        complexity: 'atomic',
        confidence: 0.85,
        contentCategory: 'conversation',
      };
    }
  }

  // Check command patterns
  for (const pattern of FAST_RULE_PATTERNS.command) {
    if (pattern.test(trimmed)) {
      return {
        intent: 'command',
        saveSignal: 'none',
        contentType: 'instruction',
        complexity: 'atomic',
        confidence: 0.9,
        contentCategory: 'general',
      };
    }
  }

  // No match
  return {
    intent: 'content',
    saveSignal: 'unclear',
    contentType: 'mixed',
    complexity: detectComplexity(text),
    confidence: 0.3,
    contentCategory: 'general',
  };
}

/**
 * Detects action verbs in input text.
 */
export function detectActionVerb(text: string): DetectedActionVerb | undefined {
  const lower = text.toLowerCase();

  for (const verb of REVIEW_VERBS) {
    const index = lower.indexOf(verb);
    if (index !== -1) {
      return { category: 'review', matched: verb, position: index };
    }
  }

  for (const verb of SAVE_VERBS) {
    const index = lower.indexOf(verb);
    if (index !== -1) {
      return { category: 'save', matched: verb, position: index };
    }
  }

  for (const verb of AMBIGUOUS_VERBS) {
    const index = lower.indexOf(verb);
    if (index !== -1) {
      return { category: 'ambiguous', matched: verb, position: index };
    }
  }

  return undefined;
}

function classifyByActionVerb(
  actionVerb: DetectedActionVerb
): Omit<Classification, 'thoughtPath' | 'classifiedBy' | 'gateResult' | 'actionVerb'> {
  switch (actionVerb.category) {
    case 'review':
      return {
        intent: 'query',
        saveSignal: 'none',
        contentType: 'question',
        complexity: 'composite',
        confidence: 0.9,
        contentCategory: 'general',
      };

    case 'save':
      return {
        intent: 'content',
        saveSignal: 'explicit',
        contentType: 'mixed',
        complexity: 'atomic',
        confidence: 0.95,
        contentCategory: 'general',
      };

    case 'ambiguous':
    default:
      return {
        intent: 'content',
        saveSignal: 'unclear',
        contentType: 'mixed',
        complexity: 'atomic',
        confidence: 0.5,
        contentCategory: 'general',
      };
  }
}

function classifyByUserLearning(
  envelope: InputEnvelope
): Omit<Classification, 'thoughtPath' | 'classifiedBy' | 'gateResult'> | null {
  const behavior = envelope.context.userBehavior;
  if (!behavior) return null;

  const text = envelope.normalized.text.toLowerCase();

  for (const pref of behavior.contentPreferences.alwaysSave) {
    if (text.includes(pref.toLowerCase())) {
      return {
        intent: 'content',
        saveSignal: 'implicit',
        contentType: 'mixed',
        complexity: 'atomic',
        confidence: 0.85,
        contentCategory: 'general',
      };
    }
  }

  for (const pref of behavior.contentPreferences.neverSave) {
    if (text.includes(pref.toLowerCase())) {
      return {
        intent: 'conversation',
        saveSignal: 'none',
        contentType: 'mixed',
        complexity: 'atomic',
        confidence: 0.85,
        contentCategory: 'general',
      };
    }
  }

  return null;
}

function detectComplexity(text: string): ComplexityLevel {
  const words = text.split(/\s+/).length;
  if (words > 500) return 'document';
  if (words > 50) return 'composite';
  return 'atomic';
}

/**
 * Adjusts threshold based on user behavior.
 */
export function adjustThreshold(baseThreshold: number, userBehavior: UserBehaviorModel): number {
  const saveAdjustment = userBehavior.typicalSaveRate * 0.2;
  const promptAdjustment = (1 - userBehavior.promptResponseRate) * 0.1;
  return Math.max(0.4, Math.min(0.95, baseThreshold - saveAdjustment + promptAdjustment));
}

/**
 * Gets adaptive threshold for content category.
 */
export function getAdaptiveThreshold(category: ContentCategory, type: 'rule' | 'prompt'): number {
  const thresholds = ADAPTIVE_THRESHOLDS[category] ?? ADAPTIVE_THRESHOLDS.general;
  return type === 'rule' ? thresholds.rule : thresholds.prompt;
}

// ============================================================
// STAGE 3: ROUTE
// ============================================================

/**
 * Selects handler based on classification.
 */
export function routeClassification(classification: Classification): RouteHandler {
  const { intent, saveSignal } = classification;

  if (intent === 'noise') {
    return { handler: 'IgnoreHandler', confidence: classification.confidence, reason: 'Noise detected' };
  }

  if (intent === 'query' || (intent === 'content' && saveSignal === 'none')) {
    return { handler: 'QueryHandler', confidence: classification.confidence, reason: `Intent: ${intent}` };
  }

  if (intent === 'content' && saveSignal === 'explicit') {
    return { handler: 'DirectSaveHandler', confidence: classification.confidence, reason: 'Explicit save' };
  }

  if (intent === 'content' && saveSignal === 'implicit') {
    return { handler: 'AccumulatorHandler', confidence: classification.confidence, reason: 'Implicit content' };
  }

  if (intent === 'content' && saveSignal === 'unclear') {
    return { handler: 'PromptHandler', confidence: classification.confidence, reason: 'Unclear save signal' };
  }

  if (intent === 'command') {
    return { handler: 'CommandHandler', confidence: classification.confidence, reason: 'Command intent' };
  }

  if (intent === 'conversation') {
    return { handler: 'ResponseHandler', confidence: classification.confidence, reason: 'Conversation' };
  }

  return { handler: 'AccumulatorHandler', confidence: 0.5, reason: 'Default routing' };
}

// ============================================================
// STAGE 4: PROCESS
// ============================================================

/**
 * Executes the selected handler.
 */
export async function processInput(
  envelope: InputEnvelope,
  classification: Classification,
  handler: RouteHandler
): Promise<ProcessResult> {
  const startTime = performance.now();

  let result: ProcessResult;

  switch (handler.handler) {
    case 'DirectSaveHandler':
      result = {
        action: 'saved',
        stagedNodes: [createStagedNode(envelope, classification)],
        metadata: { handler: handler.handler, durationMs: 0 },
      };
      break;

    case 'AccumulatorHandler':
      result = {
        action: 'accumulated',
        metadata: { handler: handler.handler, durationMs: 0 },
      };
      break;

    case 'QueryHandler':
      result = {
        action: 'queried',
        metadata: { handler: handler.handler, durationMs: 0 },
      };
      break;

    case 'PromptHandler':
      result = {
        action: 'prompted',
        promptedUser: true,
        userResponse: 'pending',
        metadata: { handler: handler.handler, durationMs: 0 },
      };
      break;

    case 'CommandHandler':
    case 'ResponseHandler':
    case 'IgnoreHandler':
    default:
      result = {
        action: 'ignored',
        metadata: { handler: handler.handler, durationMs: 0 },
      };
      break;
  }

  result.metadata.durationMs = performance.now() - startTime;
  return result;
}

function createStagedNode(envelope: InputEnvelope, classification: Classification): StagedNode {
  const text = envelope.normalized.text;
  const title = extractTitle(text);

  return {
    stagingId: generateId('stg'),
    nodeType: 'concept',
    title,
    body: text,
    contentCategory: classification.contentCategory,
    extractionConfidence: classification.confidence,
    provenance: {
      sourceType: envelope.options?.forceSave ? 'manual' : 'extraction',
      inputId: envelope.id,
      sessionId: envelope.context.sessionId,
      timestamp: envelope.timestamp,
    },
    metadata: envelope.normalized.metadata,
  };
}

function extractTitle(text: string): string {
  const firstLine = text.split('\n')[0] ?? text;
  return firstLine.slice(0, 100).trim();
}

/**
 * Determines if user should be prompted.
 */
export function shouldPrompt(classification: Classification, userBehavior?: UserBehaviorModel): boolean {
  if (classification.saveSignal !== 'unclear') return false;

  if (userBehavior) {
    const { currentSession, dismissedPrompts } = userBehavior;
    if (currentSession.promptsShown >= PROMPT_LIMITS.max_per_session &&
        dismissedPrompts >= PROMPT_LIMITS.dismissals_to_stop) {
      return false;
    }
    if (currentSession.promptsShown >= 1 &&
        currentSession.messagesSincePrompt < PROMPT_LIMITS.min_messages_between) {
      return false;
    }
  }

  const threshold = getAdaptiveThreshold(classification.contentCategory, 'prompt');
  if (classification.confidence >= threshold) return false;
  if (classification.complexity === 'atomic') return false;

  return true;
}

// ============================================================
// DOCUMENT CHUNKING
// ============================================================

/**
 * Chunks a document into smaller pieces.
 */
export function chunkDocument(
  content: string,
  options?: {
    targetMin?: number;
    targetMax?: number;
    softMax?: number;
    hardMax?: number;
    overlapPercent?: number;
  }
): DocumentChunk[] {
  const {
    targetMin = CHUNK_LIMITS.target.min,
    // targetMax and softMax reserved for future semantic chunking
    hardMax = CHUNK_LIMITS.hard_max,
    overlapPercent = CHUNK_LIMITS.overlap_percent,
  } = options ?? {};

  const boundaries = findStructuralBoundaries(content);
  const chunks: DocumentChunk[] = [];

  let sequence = 0;
  let lastEnd = 0;
  let currentHeading: string | undefined;
  let currentLevel: number | undefined;

  // Process content between boundaries
  for (let i = 0; i < boundaries.length; i++) {
    const boundary = boundaries[i];
    if (!boundary) continue;

    const chunkContent = content.slice(lastEnd, boundary.position);
    if (chunkContent.trim().length >= targetMin) {
      chunks.push({
        id: generateId('chunk'),
        sequence: sequence++,
        content: chunkContent.trim(),
        charCount: chunkContent.length,
        heading: currentHeading,
        headingLevel: currentLevel,
        splitMethod: 'structural',
      });
    }

    // Update heading for next chunk
    if (boundary.heading) {
      currentHeading = boundary.heading;
      currentLevel = boundary.level;
    }
    lastEnd = boundary.position;
  }

  // Handle remaining content after last boundary
  if (lastEnd < content.length) {
    const remaining = content.slice(lastEnd);
    if (remaining.trim().length > 0) {
      chunks.push({
        id: generateId('chunk'),
        sequence: sequence++,
        content: remaining.trim(),
        charCount: remaining.length,
        heading: currentHeading,
        headingLevel: currentLevel,
        splitMethod: 'structural',
      });
    }
  }

  // If no chunks created yet (no boundaries found), create one from whole content
  if (chunks.length === 0 && content.trim().length > 0) {
    chunks.push({
      id: generateId('chunk'),
      sequence: 0,
      content: content.trim(),
      charCount: content.length,
      splitMethod: 'structural',
    });
  }

  // Split oversized chunks
  const finalChunks: DocumentChunk[] = [];
  for (const chunk of chunks) {
    if (chunk.charCount <= hardMax) {
      finalChunks.push(chunk);
    } else {
      const subChunks = splitAtSentences(chunk.content, hardMax);
      subChunks.forEach((sub, i) => {
        finalChunks.push({
          ...chunk,
          id: generateId('chunk'),
          sequence: chunk.sequence + i * 0.1,
          content: sub,
          charCount: sub.length,
          splitMethod: 'size_limit',
        });
      });
    }
  }

  // Add overlap
  if (overlapPercent > 0) {
    for (let i = 1; i < finalChunks.length; i++) {
      const prev = finalChunks[i - 1];
      const current = finalChunks[i];
      if (prev && current) {
        const overlapLength = Math.floor(prev.charCount * overlapPercent);
        current.overlapStart = prev.content.slice(-overlapLength);
      }
    }
  }

  return finalChunks;
}

function findStructuralBoundaries(content: string): Array<{ position: number; heading?: string; level?: number }> {
  const boundaries: Array<{ position: number; heading?: string; level?: number }> = [];

  // Markdown headings
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    const hashes = match[1];
    const headingText = match[2];
    if (hashes && headingText) {
      boundaries.push({
        position: match.index,
        heading: headingText,
        level: hashes.length,
      });
    }
  }

  // Paragraph breaks
  const paragraphRegex = /\n\n+/g;
  while ((match = paragraphRegex.exec(content)) !== null) {
    boundaries.push({ position: match.index + match[0].length });
  }

  boundaries.sort((a, b) => a.position - b.position);
  return boundaries;
}

function splitAtSentences(content: string, maxLength: number): string[] {
  const sentences = content.match(/[^.!?]+[.!?]+/g);
  const chunks: string[] = [];

  // If no sentence boundaries, split at maxLength directly
  if (!sentences || sentences.length === 0) {
    let start = 0;
    while (start < content.length) {
      chunks.push(content.slice(start, start + maxLength).trim());
      start += maxLength;
    }
    return chunks.filter(c => c.length > 0);
  }

  let current = '';
  for (const sentence of sentences) {
    if (current.length + sentence.length <= maxLength) {
      current += sentence;
    } else {
      if (current) chunks.push(current.trim());
      // If a single sentence is longer than maxLength, split it
      if (sentence.length > maxLength) {
        let start = 0;
        while (start < sentence.length) {
          chunks.push(sentence.slice(start, start + maxLength).trim());
          start += maxLength;
        }
        current = '';
      } else {
        current = sentence;
      }
    }
  }

  if (current) chunks.push(current.trim());
  return chunks.filter(c => c.length > 0);
}

// ============================================================
// STAGE 5: STAGE
// ============================================================

/**
 * Validates and deduplicates staged nodes.
 */
export async function stageNodes(
  nodes: StagedNode[],
  config?: { dedupeSimilarity?: number; enableIntraBatch?: boolean }
): Promise<StagedNode[]> {
  const { dedupeSimilarity = 0.9, enableIntraBatch = true } = config ?? {};

  let staged = [...nodes];

  if (enableIntraBatch && staged.length > 1) {
    staged = deduplicateIntraBatch(staged, dedupeSimilarity);
  }

  staged = staged.filter(validateStagedNode);

  return staged;
}

function deduplicateIntraBatch(nodes: StagedNode[], threshold: number): StagedNode[] {
  const unique: StagedNode[] = [];

  for (const node of nodes) {
    const isDuplicate = unique.some(existing =>
      calculateSimilarity(existing.body, node.body) >= threshold
    );
    if (!isDuplicate) unique.push(node);
  }

  return unique;
}

function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}

function validateStagedNode(node: StagedNode): boolean {
  if (!node.stagingId || !node.title || !node.body) return false;
  if (node.body.length < 3) return false;
  return true;
}

// ============================================================
// STAGE 6: COMMIT
// ============================================================

/**
 * Commits staged nodes to the graph.
 */
export async function commitNodes(
  nodes: StagedNode[],
  _context: { userId: string; sessionId: string }
): Promise<CommitResult> {
  // _context reserved for future DB writes
  const created: string[] = [];
  const updated: string[] = [];
  const linked: string[] = [];
  const thoughtPath: ThoughtPath = {
    nodesAccessed: [],
    nodesCreated: [],
    nodesUpdated: [],
    confidenceScores: [],
    timestamp: new Date(),
  };

  for (const stagedNode of nodes) {
    const nodeId = generateId('node');
    created.push(nodeId);
    thoughtPath.nodesCreated.push(nodeId);
    thoughtPath.confidenceScores.push(stagedNode.extractionConfidence);

    if (stagedNode.suggestedEdges) {
      for (const _edge of stagedNode.suggestedEdges) {
        // _edge reserved for future edge creation with targetId/edgeType
        linked.push(generateId('edge'));
      }
    }
  }

  return {
    created,
    updated,
    linked,
    thoughtPath,
    timestamp: new Date(),
  };
}

/**
 * Creates a thought path.
 */
export function createThoughtPath(
  accessed: string[],
  created: string[],
  updated: string[],
  confidences: number[]
): ThoughtPath {
  return {
    nodesAccessed: accessed,
    nodesCreated: created,
    nodesUpdated: updated,
    confidenceScores: confidences,
    timestamp: new Date(),
  };
}

// ============================================================
// API FUNCTIONS
// ============================================================

/**
 * Main ingestion API entry point.
 */
export async function ingest(
  input: unknown,
  source: InputSource,
  context: {
    sessionId: string;
    userId: string;
    conversationHistory: ConversationMessage[];
    userBehavior?: UserBehaviorModel;
  },
  options?: IngestOptions
): Promise<IngestResult> {
  const startTime = performance.now();

  // Stage 1: RECEIVE
  const envelope = createInputEnvelope(source, input, context, options);

  // Handle incognito
  if (envelope.mode === 'incognito' && !options?.forceSave) {
    return {
      inputId: envelope.id,
      classification: {
        intent: 'content',
        saveSignal: 'none',
        contentType: 'mixed',
        complexity: 'atomic',
        confidence: 1,
        contentCategory: 'general',
        thoughtPath: [],
        classifiedBy: 'fast_rules',
      },
      action: 'ignored',
      thoughtPath: createThoughtPath([], [], [], []),
      warnings: ['Incognito mode - content not saved'],
      processingTimeMs: performance.now() - startTime,
    };
  }

  // Stage 2: CLASSIFY
  let classification = await classifyInput(envelope, {
    defaultContentCategory: options?.contentCategory,
  });

  // Override for forceSave
  if (options?.forceSave) {
    classification = {
      ...classification,
      intent: 'content',
      saveSignal: 'explicit',
      confidence: 1.0,
      contentCategory: options.contentCategory ?? classification.contentCategory,
    };
  }

  // Stage 3: ROUTE
  const handler = routeClassification(classification);

  // Stage 4: PROCESS
  const processResult = await processInput(envelope, classification, handler);

  // Stage 5 & 6: STAGE and COMMIT
  let nodes: string[] | undefined;
  let thoughtPath: ThoughtPath;

  if (processResult.stagedNodes && processResult.stagedNodes.length > 0) {
    const staged = await stageNodes(processResult.stagedNodes);
    const commitResult = await commitNodes(staged, {
      userId: context.userId,
      sessionId: context.sessionId,
    });
    nodes = commitResult.created;
    thoughtPath = commitResult.thoughtPath;
  } else {
    thoughtPath = createThoughtPath(classification.thoughtPath, [], [], [classification.confidence]);
  }

  return {
    inputId: envelope.id,
    classification,
    action: processResult.action,
    nodes,
    thoughtPath,
    processingTimeMs: performance.now() - startTime,
  };
}

/**
 * Direct save API - bypasses classification.
 */
export async function save(
  content: string,
  context: { userId: string; sessionId: string },
  options?: { contentCategory?: ContentCategory; title?: string }
): Promise<IngestResult> {
  return ingest(content, 'api', { ...context, conversationHistory: [] }, {
    forceSave: true,
    contentCategory: options?.contentCategory,
  });
}

/**
 * Classification-only API.
 */
export async function classify(
  input: string,
  context: { userId: string; sessionId: string; userBehavior?: UserBehaviorModel }
): Promise<Classification> {
  const envelope = createInputEnvelope('api', input, { ...context, conversationHistory: [] });
  return classifyInput(envelope);
}

/**
 * Creates a hardware input stream.
 */
export function createStream(_options?: StreamOptions): IngestionStream {
  // _options reserved for future stream configuration (buffer windows, etc.)
  const id = generateId('stream');

  return {
    id,
    status: 'active',
    addChunk: () => {},
    signalSilence: () => {},
    getAccumulated: () => '',
    forceExtract: async () => ({
      inputId: id,
      classification: {
        intent: 'content',
        saveSignal: 'implicit',
        contentType: 'mixed',
        complexity: 'atomic',
        confidence: 0.7,
        contentCategory: 'general',
        thoughtPath: [],
        classifiedBy: 'fast_rules',
      },
      action: 'saved',
      thoughtPath: createThoughtPath([], [], [], []),
      processingTimeMs: 0,
    }),
    pause: () => {},
    resume: () => {},
    close: async () => [],
    on: () => {},
  };
}

// ============================================================
// EXPORTS
// ============================================================

// Re-export constants
export * from './constants';

// Re-export types
export * from './types';
