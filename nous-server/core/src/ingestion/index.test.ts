/**
 * @module @nous/core/ingestion/tests
 * @description Tests for storm-014 Input & Ingestion Pipeline
 * @version 1.0.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Constants
  INPUT_SOURCES,
  INPUT_MODES,
  CLASSIFICATION_INTENTS,
  SAVE_SIGNALS,
  CONTENT_TYPES,
  COMPLEXITY_LEVELS,
  CONTENT_CATEGORIES,
  PIPELINE_STAGES,
  PROCESSING_ACTIONS,
  HANDLER_TYPES,
  REVIEW_VERBS,
  SAVE_VERBS,
  AMBIGUOUS_VERBS,
  ADAPTIVE_THRESHOLDS,
  PROMPT_LIMITS,
  CHUNK_LIMITS,
  FAST_RULE_PATTERNS,
  WORKING_MEMORY_DURATIONS,

  // Types
  type InputEnvelope,
  type Classification,
  type UserBehaviorModel,
  type StagedNode,
  type ThoughtPath,
  type IngestResult,
  type DocumentChunk,

  // Schemas
  InputEnvelopeSchema,
  ClassificationSchema,
  UserBehaviorModelSchema,
  StagedNodeSchema,
  ThoughtPathSchema,
  IngestResultSchema,
  DocumentChunkSchema,

  // Functions
  createInputEnvelope,
  classifyInput,
  fastRuleClassify,
  detectActionVerb,
  adjustThreshold,
  getAdaptiveThreshold,
  routeClassification,
  processInput,
  shouldPrompt,
  chunkDocument,
  stageNodes,
  commitNodes,
  createThoughtPath,
  ingest,
  save,
  classify,
  createStream,
} from './index';

// ============================================================
// CONSTANTS TESTS
// ============================================================

describe('Constants', () => {
  describe('INPUT_SOURCES', () => {
    it('should have 5 input sources', () => {
      expect(INPUT_SOURCES).toHaveLength(5);
      expect(INPUT_SOURCES).toContain('chat');
      expect(INPUT_SOURCES).toContain('file');
      expect(INPUT_SOURCES).toContain('voice');
      expect(INPUT_SOURCES).toContain('api');
      expect(INPUT_SOURCES).toContain('stream');
    });
  });

  describe('INPUT_MODES', () => {
    it('should have 2 input modes', () => {
      expect(INPUT_MODES).toHaveLength(2);
      expect(INPUT_MODES).toContain('normal');
      expect(INPUT_MODES).toContain('incognito');
    });
  });

  describe('CLASSIFICATION_INTENTS', () => {
    it('should have 5 classification intents', () => {
      expect(CLASSIFICATION_INTENTS).toHaveLength(5);
      expect(CLASSIFICATION_INTENTS).toContain('query');
      expect(CLASSIFICATION_INTENTS).toContain('content');
      expect(CLASSIFICATION_INTENTS).toContain('command');
      expect(CLASSIFICATION_INTENTS).toContain('conversation');
      expect(CLASSIFICATION_INTENTS).toContain('noise');
    });
  });

  describe('SAVE_SIGNALS', () => {
    it('should have 4 save signals', () => {
      expect(SAVE_SIGNALS).toHaveLength(4);
      expect(SAVE_SIGNALS).toContain('explicit');
      expect(SAVE_SIGNALS).toContain('implicit');
      expect(SAVE_SIGNALS).toContain('none');
      expect(SAVE_SIGNALS).toContain('unclear');
    });
  });

  describe('PIPELINE_STAGES', () => {
    it('should have 6 pipeline stages in order', () => {
      expect(PIPELINE_STAGES).toHaveLength(6);
      expect(PIPELINE_STAGES[0]).toBe('RECEIVE');
      expect(PIPELINE_STAGES[1]).toBe('CLASSIFY');
      expect(PIPELINE_STAGES[2]).toBe('ROUTE');
      expect(PIPELINE_STAGES[3]).toBe('PROCESS');
      expect(PIPELINE_STAGES[4]).toBe('STAGE');
      expect(PIPELINE_STAGES[5]).toBe('COMMIT');
    });
  });

  describe('ACTION_VERBS', () => {
    it('should have review verbs', () => {
      expect(REVIEW_VERBS.length).toBeGreaterThan(0);
      expect(REVIEW_VERBS).toContain('review');
      expect(REVIEW_VERBS).toContain('check');
    });

    it('should have save verbs', () => {
      expect(SAVE_VERBS.length).toBeGreaterThan(0);
      expect(SAVE_VERBS).toContain('save');
      expect(SAVE_VERBS).toContain('remember');
    });

    it('should have ambiguous verbs', () => {
      expect(AMBIGUOUS_VERBS.length).toBeGreaterThan(0);
      expect(AMBIGUOUS_VERBS).toContain('look at');
    });
  });

  describe('ADAPTIVE_THRESHOLDS', () => {
    it('should have thresholds for all content categories', () => {
      for (const category of CONTENT_CATEGORIES) {
        expect(ADAPTIVE_THRESHOLDS[category]).toBeDefined();
        expect(ADAPTIVE_THRESHOLDS[category].rule).toBeGreaterThan(0);
        expect(ADAPTIVE_THRESHOLDS[category].rule).toBeLessThanOrEqual(1);
        expect(ADAPTIVE_THRESHOLDS[category].prompt).toBeGreaterThan(0);
        expect(ADAPTIVE_THRESHOLDS[category].prompt).toBeLessThanOrEqual(1);
      }
    });

    it('should have identity with lower threshold (better to save)', () => {
      expect(ADAPTIVE_THRESHOLDS.identity.rule).toBeLessThan(ADAPTIVE_THRESHOLDS.general.rule);
    });

    it('should have document with higher threshold (worth asking)', () => {
      expect(ADAPTIVE_THRESHOLDS.document.rule).toBeGreaterThan(ADAPTIVE_THRESHOLDS.general.rule);
    });
  });

  describe('PROMPT_LIMITS', () => {
    it('should have max per session of 3', () => {
      expect(PROMPT_LIMITS.max_per_session).toBe(3);
    });

    it('should have min messages between of 5', () => {
      expect(PROMPT_LIMITS.min_messages_between).toBe(5);
    });
  });

  describe('CHUNK_LIMITS', () => {
    it('should have target range', () => {
      expect(CHUNK_LIMITS.target.min).toBe(500);
      expect(CHUNK_LIMITS.target.max).toBe(2000);
    });

    it('should have soft max of 3000', () => {
      expect(CHUNK_LIMITS.soft_max).toBe(3000);
    });

    it('should have hard max of 5000', () => {
      expect(CHUNK_LIMITS.hard_max).toBe(5000);
    });
  });

  describe('WORKING_MEMORY_DURATIONS', () => {
    it('should have durations for all content categories', () => {
      for (const category of CONTENT_CATEGORIES) {
        expect(WORKING_MEMORY_DURATIONS[category]).toBeDefined();
        expect(WORKING_MEMORY_DURATIONS[category]).toBeGreaterThan(0);
      }
    });

    it('should have identity with 48h duration', () => {
      expect(WORKING_MEMORY_DURATIONS.identity).toBe(48);
    });

    it('should have conversation with 6h duration', () => {
      expect(WORKING_MEMORY_DURATIONS.conversation).toBe(6);
    });
  });
});

// ============================================================
// SCHEMA TESTS
// ============================================================

describe('Schemas', () => {
  describe('InputEnvelopeSchema', () => {
    it('should validate a valid envelope', () => {
      const envelope: InputEnvelope = {
        id: 'inp_abc123',
        timestamp: new Date(),
        source: 'chat',
        mode: 'normal',
        raw: 'test message',
        normalized: {
          text: 'test message',
          metadata: { source: 'chat' },
        },
        context: {
          sessionId: 'sess_xyz',
          userId: 'user_123',
          conversationHistory: [],
        },
      };

      const result = InputEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(true);
    });

    it('should reject invalid source', () => {
      const envelope = {
        id: 'inp_abc123',
        timestamp: new Date(),
        source: 'invalid_source',
        mode: 'normal',
        raw: 'test',
        normalized: { text: 'test', metadata: {} },
        context: { sessionId: 'sess', userId: 'user', conversationHistory: [] },
      };

      const result = InputEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(false);
    });
  });

  describe('ClassificationSchema', () => {
    it('should validate a valid classification', () => {
      const classification: Classification = {
        intent: 'content',
        saveSignal: 'explicit',
        contentType: 'fact',
        complexity: 'atomic',
        confidence: 0.9,
        contentCategory: 'general',
        thoughtPath: [],
        classifiedBy: 'fast_rules',
      };

      const result = ClassificationSchema.safeParse(classification);
      expect(result.success).toBe(true);
    });

    it('should reject confidence out of range', () => {
      const classification = {
        intent: 'content',
        saveSignal: 'explicit',
        contentType: 'fact',
        complexity: 'atomic',
        confidence: 1.5, // Invalid
        contentCategory: 'general',
        thoughtPath: [],
        classifiedBy: 'fast_rules',
      };

      const result = ClassificationSchema.safeParse(classification);
      expect(result.success).toBe(false);
    });
  });

  describe('StagedNodeSchema', () => {
    it('should validate a valid staged node', () => {
      const node: StagedNode = {
        stagingId: 'stg_abc',
        nodeType: 'concept',
        title: 'Test Title',
        body: 'Test body content',
        contentCategory: 'general',
        extractionConfidence: 0.8,
        provenance: {
          sourceType: 'extraction',
          inputId: 'inp_xyz',
          sessionId: 'sess_123',
          timestamp: new Date(),
        },
        metadata: {},
      };

      const result = StagedNodeSchema.safeParse(node);
      expect(result.success).toBe(true);
    });
  });

  describe('ThoughtPathSchema', () => {
    it('should validate a valid thought path', () => {
      const thoughtPath: ThoughtPath = {
        nodesAccessed: ['node1', 'node2'],
        nodesCreated: ['node3'],
        nodesUpdated: [],
        confidenceScores: [0.8, 0.9],
        timestamp: new Date(),
      };

      const result = ThoughtPathSchema.safeParse(thoughtPath);
      expect(result.success).toBe(true);
    });
  });

  describe('DocumentChunkSchema', () => {
    it('should validate a valid document chunk', () => {
      const chunk: DocumentChunk = {
        id: 'chunk_abc',
        sequence: 0,
        content: 'Chunk content here',
        charCount: 18,
        splitMethod: 'structural',
      };

      const result = DocumentChunkSchema.safeParse(chunk);
      expect(result.success).toBe(true);
    });

    it('should validate chunk with heading', () => {
      const chunk: DocumentChunk = {
        id: 'chunk_abc',
        sequence: 0,
        content: 'Content',
        charCount: 7,
        heading: 'Section Title',
        headingLevel: 2,
        splitMethod: 'structural',
      };

      const result = DocumentChunkSchema.safeParse(chunk);
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================
// RECEIVE STAGE TESTS
// ============================================================

describe('Stage 1: RECEIVE', () => {
  describe('createInputEnvelope', () => {
    it('should create envelope for chat input', () => {
      const envelope = createInputEnvelope(
        'chat',
        'Hello world',
        { sessionId: 'sess', userId: 'user', conversationHistory: [] }
      );

      expect(envelope.id).toMatch(/^inp_/);
      expect(envelope.source).toBe('chat');
      expect(envelope.mode).toBe('normal');
      expect(envelope.normalized.text).toBe('Hello world');
    });

    it('should respect mode option', () => {
      const envelope = createInputEnvelope(
        'chat',
        'Secret message',
        { sessionId: 'sess', userId: 'user', conversationHistory: [] },
        { mode: 'incognito' }
      );

      expect(envelope.mode).toBe('incognito');
    });

    it('should handle voice input', () => {
      const envelope = createInputEnvelope(
        'voice',
        'Transcribed voice content',
        { sessionId: 'sess', userId: 'user', conversationHistory: [] }
      );

      expect(envelope.source).toBe('voice');
      expect(envelope.normalized.metadata.whisperProcessed).toBe(true);
    });

    it('should handle api input with content field', () => {
      const envelope = createInputEnvelope(
        'api',
        { content: 'API content', metadata: { custom: 'value' } },
        { sessionId: 'sess', userId: 'user', conversationHistory: [] }
      );

      expect(envelope.source).toBe('api');
      expect(envelope.normalized.text).toBe('API content');
      expect(envelope.normalized.metadata.custom).toBe('value');
    });

    it('should trim whitespace from text', () => {
      const envelope = createInputEnvelope(
        'chat',
        '  trimmed content  ',
        { sessionId: 'sess', userId: 'user', conversationHistory: [] }
      );

      expect(envelope.normalized.text).toBe('trimmed content');
    });
  });
});

// ============================================================
// CLASSIFY STAGE TESTS
// ============================================================

describe('Stage 2: CLASSIFY', () => {
  describe('fastRuleClassify', () => {
    it('should detect explicit save signal', () => {
      const result = fastRuleClassify('Remember this important fact');
      expect(result.intent).toBe('content');
      expect(result.saveSignal).toBe('explicit');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('should detect question intent', () => {
      const result = fastRuleClassify('What is the weather today?');
      expect(result.intent).toBe('query');
      expect(result.saveSignal).toBe('none');
    });

    it('should detect question by ending with ?', () => {
      const result = fastRuleClassify('Can you help me with this?');
      expect(result.intent).toBe('query');
    });

    it('should detect social/conversation intent', () => {
      const result = fastRuleClassify('Hello!');
      expect(result.intent).toBe('conversation');
      expect(result.saveSignal).toBe('none');
    });

    it('should detect command intent', () => {
      const result = fastRuleClassify('Search for documents about AI');
      expect(result.intent).toBe('command');
    });

    it('should return unclear for ambiguous content', () => {
      const result = fastRuleClassify('The project deadline is next week');
      expect(result.saveSignal).toBe('unclear');
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('should handle "dont forget" pattern', () => {
      const result = fastRuleClassify("Don't forget to call mom");
      expect(result.saveSignal).toBe('explicit');
    });
  });

  describe('detectActionVerb', () => {
    it('should detect review verbs', () => {
      const result = detectActionVerb('Please review this document');
      expect(result).toBeDefined();
      expect(result!.category).toBe('review');
      expect(result!.matched).toBe('review');
    });

    it('should detect save verbs', () => {
      const result = detectActionVerb('Save this information');
      expect(result).toBeDefined();
      expect(result!.category).toBe('save');
      expect(result!.matched).toBe('save');
    });

    it('should detect ambiguous verbs', () => {
      const result = detectActionVerb('Look at this code');
      expect(result).toBeDefined();
      expect(result!.category).toBe('ambiguous');
    });

    it('should return undefined when no verb found', () => {
      const result = detectActionVerb('The weather is nice today');
      expect(result).toBeUndefined();
    });

    it('should include position', () => {
      const result = detectActionVerb('Please check the data');
      expect(result!.position).toBeGreaterThan(0);
    });
  });

  describe('classifyInput', () => {
    it('should classify explicit save content', async () => {
      const envelope = createInputEnvelope(
        'chat',
        'Remember that my birthday is January 15th',
        { sessionId: 'sess', userId: 'user', conversationHistory: [] }
      );

      const result = await classifyInput(envelope);
      expect(result.saveSignal).toBe('explicit');
      expect(result.classifiedBy).toBe('fast_rules');
    });

    it('should classify questions correctly', async () => {
      const envelope = createInputEnvelope(
        'chat',
        'What did we discuss yesterday?',
        { sessionId: 'sess', userId: 'user', conversationHistory: [] }
      );

      const result = await classifyInput(envelope);
      expect(result.intent).toBe('query');
    });

    it('should use user behavior learning when available', async () => {
      const userBehavior: UserBehaviorModel = {
        userId: 'user_123',
        typicalSaveRate: 0.8,
        promptResponseRate: 0.9,
        dismissedPrompts: 0,
        contentPreferences: {
          alwaysSave: ['meeting notes'],
          neverSave: ['small talk'],
        },
        currentSession: { promptsShown: 0, messagesSincePrompt: 0 },
        lastUpdated: new Date(),
      };

      const envelope = createInputEnvelope(
        'chat',
        'Here are the meeting notes from today',
        { sessionId: 'sess', userId: 'user', conversationHistory: [], userBehavior }
      );

      const result = await classifyInput(envelope);
      expect(result.classifiedBy).toBe('user_learning');
      expect(result.saveSignal).toBe('implicit');
    });
  });

  describe('adjustThreshold', () => {
    it('should lower threshold for high save rate users', () => {
      const userBehavior: UserBehaviorModel = {
        userId: 'user',
        typicalSaveRate: 0.9,
        promptResponseRate: 0.9,
        dismissedPrompts: 0,
        contentPreferences: { alwaysSave: [], neverSave: [] },
        currentSession: { promptsShown: 0, messagesSincePrompt: 0 },
        lastUpdated: new Date(),
      };

      const adjusted = adjustThreshold(0.75, userBehavior);
      expect(adjusted).toBeLessThan(0.75);
    });

    it('should keep threshold within bounds', () => {
      const userBehavior: UserBehaviorModel = {
        userId: 'user',
        typicalSaveRate: 1.0,
        promptResponseRate: 1.0,
        dismissedPrompts: 0,
        contentPreferences: { alwaysSave: [], neverSave: [] },
        currentSession: { promptsShown: 0, messagesSincePrompt: 0 },
        lastUpdated: new Date(),
      };

      const adjusted = adjustThreshold(0.5, userBehavior);
      expect(adjusted).toBeGreaterThanOrEqual(0.4);
      expect(adjusted).toBeLessThanOrEqual(0.95);
    });
  });

  describe('getAdaptiveThreshold', () => {
    it('should return rule threshold', () => {
      const threshold = getAdaptiveThreshold('identity', 'rule');
      expect(threshold).toBe(0.6);
    });

    it('should return prompt threshold', () => {
      const threshold = getAdaptiveThreshold('identity', 'prompt');
      expect(threshold).toBe(0.5);
    });

    it('should fall back to general', () => {
      const threshold = getAdaptiveThreshold('general', 'rule');
      expect(threshold).toBe(0.75);
    });
  });
});

// ============================================================
// ROUTE STAGE TESTS
// ============================================================

describe('Stage 3: ROUTE', () => {
  describe('routeClassification', () => {
    it('should route noise to IgnoreHandler', () => {
      const classification: Classification = {
        intent: 'noise',
        saveSignal: 'none',
        contentType: 'mixed',
        complexity: 'atomic',
        confidence: 0.95,
        contentCategory: 'general',
        thoughtPath: [],
        classifiedBy: 'fast_rules',
      };

      const result = routeClassification(classification);
      expect(result.handler).toBe('IgnoreHandler');
    });

    it('should route query to QueryHandler', () => {
      const classification: Classification = {
        intent: 'query',
        saveSignal: 'none',
        contentType: 'question',
        complexity: 'atomic',
        confidence: 0.9,
        contentCategory: 'general',
        thoughtPath: [],
        classifiedBy: 'fast_rules',
      };

      const result = routeClassification(classification);
      expect(result.handler).toBe('QueryHandler');
    });

    it('should route explicit save to DirectSaveHandler', () => {
      const classification: Classification = {
        intent: 'content',
        saveSignal: 'explicit',
        contentType: 'fact',
        complexity: 'atomic',
        confidence: 0.95,
        contentCategory: 'general',
        thoughtPath: [],
        classifiedBy: 'fast_rules',
      };

      const result = routeClassification(classification);
      expect(result.handler).toBe('DirectSaveHandler');
    });

    it('should route implicit content to AccumulatorHandler', () => {
      const classification: Classification = {
        intent: 'content',
        saveSignal: 'implicit',
        contentType: 'fact',
        complexity: 'atomic',
        confidence: 0.8,
        contentCategory: 'general',
        thoughtPath: [],
        classifiedBy: 'llm',
      };

      const result = routeClassification(classification);
      expect(result.handler).toBe('AccumulatorHandler');
    });

    it('should route unclear content to PromptHandler', () => {
      const classification: Classification = {
        intent: 'content',
        saveSignal: 'unclear',
        contentType: 'mixed',
        complexity: 'composite',
        confidence: 0.5,
        contentCategory: 'general',
        thoughtPath: [],
        classifiedBy: 'llm',
      };

      const result = routeClassification(classification);
      expect(result.handler).toBe('PromptHandler');
    });

    it('should route command to CommandHandler', () => {
      const classification: Classification = {
        intent: 'command',
        saveSignal: 'none',
        contentType: 'instruction',
        complexity: 'atomic',
        confidence: 0.9,
        contentCategory: 'general',
        thoughtPath: [],
        classifiedBy: 'fast_rules',
      };

      const result = routeClassification(classification);
      expect(result.handler).toBe('CommandHandler');
    });

    it('should route conversation to ResponseHandler', () => {
      const classification: Classification = {
        intent: 'conversation',
        saveSignal: 'none',
        contentType: 'mixed',
        complexity: 'atomic',
        confidence: 0.85,
        contentCategory: 'conversation',
        thoughtPath: [],
        classifiedBy: 'fast_rules',
      };

      const result = routeClassification(classification);
      expect(result.handler).toBe('ResponseHandler');
    });
  });
});

// ============================================================
// PROCESS STAGE TESTS
// ============================================================

describe('Stage 4: PROCESS', () => {
  describe('processInput', () => {
    it('should process DirectSaveHandler with staged nodes', async () => {
      const envelope = createInputEnvelope(
        'chat',
        'Important fact to save',
        { sessionId: 'sess', userId: 'user', conversationHistory: [] }
      );

      const classification: Classification = {
        intent: 'content',
        saveSignal: 'explicit',
        contentType: 'fact',
        complexity: 'atomic',
        confidence: 0.95,
        contentCategory: 'general',
        thoughtPath: [],
        classifiedBy: 'fast_rules',
      };

      const handler = routeClassification(classification);
      const result = await processInput(envelope, classification, handler);

      expect(result.action).toBe('saved');
      expect(result.stagedNodes).toBeDefined();
      expect(result.stagedNodes!.length).toBeGreaterThan(0);
    });

    it('should process QueryHandler without staged nodes', async () => {
      const envelope = createInputEnvelope(
        'chat',
        'What is the answer?',
        { sessionId: 'sess', userId: 'user', conversationHistory: [] }
      );

      const classification: Classification = {
        intent: 'query',
        saveSignal: 'none',
        contentType: 'question',
        complexity: 'atomic',
        confidence: 0.9,
        contentCategory: 'general',
        thoughtPath: [],
        classifiedBy: 'fast_rules',
      };

      const handler = routeClassification(classification);
      const result = await processInput(envelope, classification, handler);

      expect(result.action).toBe('queried');
      expect(result.stagedNodes).toBeUndefined();
    });

    it('should track processing duration', async () => {
      const envelope = createInputEnvelope(
        'chat',
        'Test content',
        { sessionId: 'sess', userId: 'user', conversationHistory: [] }
      );

      const classification: Classification = {
        intent: 'conversation',
        saveSignal: 'none',
        contentType: 'mixed',
        complexity: 'atomic',
        confidence: 0.85,
        contentCategory: 'conversation',
        thoughtPath: [],
        classifiedBy: 'fast_rules',
      };

      const handler = routeClassification(classification);
      const result = await processInput(envelope, classification, handler);

      expect(result.metadata.durationMs).toBeDefined();
      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('shouldPrompt', () => {
    it('should not prompt when save signal is clear', () => {
      const classification: Classification = {
        intent: 'content',
        saveSignal: 'explicit',
        contentType: 'fact',
        complexity: 'atomic',
        confidence: 0.95,
        contentCategory: 'general',
        thoughtPath: [],
        classifiedBy: 'fast_rules',
      };

      expect(shouldPrompt(classification)).toBe(false);
    });

    it('should not prompt for atomic content', () => {
      const classification: Classification = {
        intent: 'content',
        saveSignal: 'unclear',
        contentType: 'mixed',
        complexity: 'atomic',
        confidence: 0.5,
        contentCategory: 'general',
        thoughtPath: [],
        classifiedBy: 'llm',
      };

      expect(shouldPrompt(classification)).toBe(false);
    });

    it('should respect session prompt limits', () => {
      const classification: Classification = {
        intent: 'content',
        saveSignal: 'unclear',
        contentType: 'mixed',
        complexity: 'composite',
        confidence: 0.5,
        contentCategory: 'general',
        thoughtPath: [],
        classifiedBy: 'llm',
      };

      const userBehavior: UserBehaviorModel = {
        userId: 'user',
        typicalSaveRate: 0.5,
        promptResponseRate: 0.3,
        dismissedPrompts: 3,
        contentPreferences: { alwaysSave: [], neverSave: [] },
        currentSession: { promptsShown: 4, messagesSincePrompt: 1 },
        lastUpdated: new Date(),
      };

      expect(shouldPrompt(classification, userBehavior)).toBe(false);
    });
  });
});

// ============================================================
// CHUNKING TESTS
// ============================================================

describe('Document Chunking', () => {
  describe('chunkDocument', () => {
    it('should chunk document with headings', () => {
      const content = `# Introduction

This is the introduction section with some content.

# Chapter 1

This is chapter 1 with more detailed content.

# Chapter 2

This is chapter 2 with even more content.`;

      const chunks = chunkDocument(content);
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should detect markdown headings', () => {
      const content = `# Main Title

Some content here.

## Subsection

More content here.`;

      const chunks = chunkDocument(content);
      const headingChunk = chunks.find(c => c.heading);
      expect(headingChunk).toBeDefined();
    });

    it('should split oversized chunks', () => {
      const longContent = 'A'.repeat(6000);
      const chunks = chunkDocument(longContent);

      // Should be split because > 5000 chars
      const allUnderLimit = chunks.every(c => c.charCount <= CHUNK_LIMITS.hard_max);
      expect(allUnderLimit).toBe(true);
    });

    it('should add overlap between chunks', () => {
      const content = `# Section 1

${'Content for section 1. '.repeat(50)}

# Section 2

${'Content for section 2. '.repeat(50)}`;

      const chunks = chunkDocument(content);
      if (chunks.length > 1) {
        const hasOverlap = chunks.some((c, i) => i > 0 && c.overlapStart);
        expect(hasOverlap).toBe(true);
      }
    });

    it('should assign sequence numbers', () => {
      const content = `# A

Content A.

# B

Content B.`;

      const chunks = chunkDocument(content);
      chunks.forEach((chunk, i) => {
        expect(chunk.sequence).toBeDefined();
      });
    });

    it('should mark split method', () => {
      const content = '# Title\n\nContent here.';
      const chunks = chunkDocument(content);
      chunks.forEach(chunk => {
        expect(['structural', 'semantic', 'size_limit']).toContain(chunk.splitMethod);
      });
    });
  });
});

// ============================================================
// STAGING TESTS
// ============================================================

describe('Stage 5: STAGE', () => {
  describe('stageNodes', () => {
    it('should remove duplicates within batch', async () => {
      const nodes: StagedNode[] = [
        {
          stagingId: 'stg_1',
          nodeType: 'concept',
          title: 'Test',
          body: 'This is the same content',
          contentCategory: 'general',
          extractionConfidence: 0.8,
          provenance: { sourceType: 'extraction', inputId: 'inp_1', sessionId: 'sess', timestamp: new Date() },
          metadata: {},
        },
        {
          stagingId: 'stg_2',
          nodeType: 'concept',
          title: 'Test',
          body: 'This is the same content', // Duplicate
          contentCategory: 'general',
          extractionConfidence: 0.8,
          provenance: { sourceType: 'extraction', inputId: 'inp_2', sessionId: 'sess', timestamp: new Date() },
          metadata: {},
        },
      ];

      const staged = await stageNodes(nodes);
      expect(staged.length).toBe(1);
    });

    it('should keep unique nodes', async () => {
      const nodes: StagedNode[] = [
        {
          stagingId: 'stg_1',
          nodeType: 'concept',
          title: 'First',
          body: 'First unique content here',
          contentCategory: 'general',
          extractionConfidence: 0.8,
          provenance: { sourceType: 'extraction', inputId: 'inp_1', sessionId: 'sess', timestamp: new Date() },
          metadata: {},
        },
        {
          stagingId: 'stg_2',
          nodeType: 'concept',
          title: 'Second',
          body: 'Second completely different content',
          contentCategory: 'general',
          extractionConfidence: 0.8,
          provenance: { sourceType: 'extraction', inputId: 'inp_2', sessionId: 'sess', timestamp: new Date() },
          metadata: {},
        },
      ];

      const staged = await stageNodes(nodes);
      expect(staged.length).toBe(2);
    });

    it('should filter invalid nodes', async () => {
      const nodes: StagedNode[] = [
        {
          stagingId: 'stg_1',
          nodeType: 'concept',
          title: 'Valid',
          body: 'Valid content',
          contentCategory: 'general',
          extractionConfidence: 0.8,
          provenance: { sourceType: 'extraction', inputId: 'inp_1', sessionId: 'sess', timestamp: new Date() },
          metadata: {},
        },
        {
          stagingId: 'stg_2',
          nodeType: 'concept',
          title: '',
          body: '', // Invalid - empty
          contentCategory: 'general',
          extractionConfidence: 0.8,
          provenance: { sourceType: 'extraction', inputId: 'inp_2', sessionId: 'sess', timestamp: new Date() },
          metadata: {},
        },
      ];

      const staged = await stageNodes(nodes);
      expect(staged.length).toBe(1);
    });

    it('should respect dedupe config', async () => {
      const nodes: StagedNode[] = [
        {
          stagingId: 'stg_1',
          nodeType: 'concept',
          title: 'Test',
          body: 'Similar content A',
          contentCategory: 'general',
          extractionConfidence: 0.8,
          provenance: { sourceType: 'extraction', inputId: 'inp_1', sessionId: 'sess', timestamp: new Date() },
          metadata: {},
        },
        {
          stagingId: 'stg_2',
          nodeType: 'concept',
          title: 'Test',
          body: 'Similar content B',
          contentCategory: 'general',
          extractionConfidence: 0.8,
          provenance: { sourceType: 'extraction', inputId: 'inp_2', sessionId: 'sess', timestamp: new Date() },
          metadata: {},
        },
      ];

      // With low threshold, should keep both
      const staged = await stageNodes(nodes, { dedupeSimilarity: 0.99 });
      expect(staged.length).toBe(2);
    });
  });
});

// ============================================================
// COMMIT TESTS
// ============================================================

describe('Stage 6: COMMIT', () => {
  describe('commitNodes', () => {
    it('should create nodes and return IDs', async () => {
      const nodes: StagedNode[] = [
        {
          stagingId: 'stg_1',
          nodeType: 'concept',
          title: 'Test',
          body: 'Test content',
          contentCategory: 'general',
          extractionConfidence: 0.8,
          provenance: { sourceType: 'extraction', inputId: 'inp_1', sessionId: 'sess', timestamp: new Date() },
          metadata: {},
        },
      ];

      const result = await commitNodes(nodes, { userId: 'user', sessionId: 'sess' });

      expect(result.created.length).toBe(1);
      expect(result.created[0]).toMatch(/^node_/);
    });

    it('should populate thought path', async () => {
      const nodes: StagedNode[] = [
        {
          stagingId: 'stg_1',
          nodeType: 'concept',
          title: 'Test',
          body: 'Test content',
          contentCategory: 'general',
          extractionConfidence: 0.8,
          provenance: { sourceType: 'extraction', inputId: 'inp_1', sessionId: 'sess', timestamp: new Date() },
          metadata: {},
        },
      ];

      const result = await commitNodes(nodes, { userId: 'user', sessionId: 'sess' });

      expect(result.thoughtPath.nodesCreated.length).toBe(1);
      expect(result.thoughtPath.confidenceScores.length).toBe(1);
      expect(result.thoughtPath.timestamp).toBeDefined();
    });

    it('should handle suggested edges', async () => {
      const nodes: StagedNode[] = [
        {
          stagingId: 'stg_1',
          nodeType: 'concept',
          title: 'Test',
          body: 'Test content',
          contentCategory: 'general',
          extractionConfidence: 0.8,
          provenance: { sourceType: 'extraction', inputId: 'inp_1', sessionId: 'sess', timestamp: new Date() },
          suggestedEdges: [
            { targetId: 'node_existing', edgeType: 'relates_to', strength: 0.7 },
          ],
          metadata: {},
        },
      ];

      const result = await commitNodes(nodes, { userId: 'user', sessionId: 'sess' });
      expect(result.linked.length).toBe(1);
    });
  });

  describe('createThoughtPath', () => {
    it('should create thought path with all fields', () => {
      const path = createThoughtPath(
        ['node1', 'node2'],
        ['node3'],
        ['node4'],
        [0.8, 0.9, 0.7]
      );

      expect(path.nodesAccessed).toEqual(['node1', 'node2']);
      expect(path.nodesCreated).toEqual(['node3']);
      expect(path.nodesUpdated).toEqual(['node4']);
      expect(path.confidenceScores).toEqual([0.8, 0.9, 0.7]);
      expect(path.timestamp).toBeDefined();
    });
  });
});

// ============================================================
// API FUNCTION TESTS
// ============================================================

describe('API Functions', () => {
  describe('ingest', () => {
    it('should process chat input through full pipeline', async () => {
      const result = await ingest(
        'Remember that my favorite color is blue',
        'chat',
        { sessionId: 'sess', userId: 'user', conversationHistory: [] }
      );

      expect(result.inputId).toMatch(/^inp_/);
      expect(result.classification).toBeDefined();
      expect(result.action).toBeDefined();
      expect(result.thoughtPath).toBeDefined();
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle incognito mode', async () => {
      const result = await ingest(
        'Secret information',
        'chat',
        { sessionId: 'sess', userId: 'user', conversationHistory: [] },
        { mode: 'incognito' }
      );

      expect(result.action).toBe('ignored');
      expect(result.warnings).toContain('Incognito mode - content not saved');
    });

    it('should respect forceSave option', async () => {
      const result = await ingest(
        'Must save this',
        'api',
        { sessionId: 'sess', userId: 'user', conversationHistory: [] },
        { forceSave: true }
      );

      expect(result.action).toBe('saved');
    });

    it('should return created node IDs', async () => {
      const result = await ingest(
        'Save this important fact',
        'chat',
        { sessionId: 'sess', userId: 'user', conversationHistory: [] }
      );

      expect(result.nodes).toBeDefined();
      expect(result.nodes!.length).toBeGreaterThan(0);
    });
  });

  describe('save', () => {
    it('should directly save content', async () => {
      const result = await save(
        'Directly saved content',
        { userId: 'user', sessionId: 'sess' }
      );

      expect(result.action).toBe('saved');
      expect(result.nodes).toBeDefined();
    });

    it('should accept content category', async () => {
      const result = await save(
        'Identity fact',
        { userId: 'user', sessionId: 'sess' },
        { contentCategory: 'identity' }
      );

      expect(result.classification.contentCategory).toBe('identity');
    });
  });

  describe('classify', () => {
    it('should return classification without saving', async () => {
      const result = await classify(
        'What is this?',
        { userId: 'user', sessionId: 'sess' }
      );

      expect(result.intent).toBeDefined();
      expect(result.saveSignal).toBeDefined();
      expect(result.confidence).toBeDefined();
    });

    it('should detect question intent', async () => {
      const result = await classify(
        'How does this work?',
        { userId: 'user', sessionId: 'sess' }
      );

      expect(result.intent).toBe('query');
    });
  });

  describe('createStream', () => {
    it('should create stream with active status', () => {
      const stream = createStream();
      expect(stream.id).toMatch(/^stream_/);
      expect(stream.status).toBe('active');
    });

    it('should have all required methods', () => {
      const stream = createStream();
      expect(typeof stream.addChunk).toBe('function');
      expect(typeof stream.signalSilence).toBe('function');
      expect(typeof stream.forceExtract).toBe('function');
      expect(typeof stream.pause).toBe('function');
      expect(typeof stream.resume).toBe('function');
      expect(typeof stream.close).toBe('function');
      expect(typeof stream.on).toBe('function');
    });

    it('should return result from forceExtract', async () => {
      const stream = createStream();
      const result = await stream.forceExtract();
      expect(result.inputId).toBeDefined();
      expect(result.classification).toBeDefined();
    });
  });
});

// ============================================================
// INTEGRATION TESTS
// ============================================================

describe('Pipeline Integration', () => {
  it('should process explicit save through all stages', async () => {
    const result = await ingest(
      'Remember this: my phone number is 555-1234',
      'chat',
      { sessionId: 'sess_int', userId: 'user_int', conversationHistory: [] }
    );

    // Should detect explicit save
    expect(result.classification.saveSignal).toBe('explicit');

    // Should route to DirectSaveHandler
    expect(result.action).toBe('saved');

    // Should create nodes
    expect(result.nodes).toBeDefined();
    expect(result.nodes!.length).toBeGreaterThan(0);

    // Should have thought path
    expect(result.thoughtPath.nodesCreated.length).toBeGreaterThan(0);
  });

  it('should process query without saving', async () => {
    const result = await ingest(
      'What time is the meeting tomorrow?',
      'chat',
      { sessionId: 'sess_int', userId: 'user_int', conversationHistory: [] }
    );

    // Should detect query
    expect(result.classification.intent).toBe('query');
    expect(result.classification.saveSignal).toBe('none');

    // Should not save
    expect(result.action).toBe('queried');
    expect(result.nodes).toBeUndefined();
  });

  it('should handle conversation appropriately', async () => {
    const result = await ingest(
      'Thanks!',
      'chat',
      { sessionId: 'sess_int', userId: 'user_int', conversationHistory: [] }
    );

    // Should detect conversation
    expect(result.classification.intent).toBe('conversation');

    // Should not save
    expect(result.action).toBe('ignored');
  });

  it('should process API input correctly', async () => {
    const result = await ingest(
      { content: 'API provided content', metadata: { source: 'external' } },
      'api',
      { sessionId: 'sess_api', userId: 'user_api', conversationHistory: [] }
    );

    expect(result.inputId).toBeDefined();
    expect(result.classification).toBeDefined();
  });

  it('should measure processing time', async () => {
    const result = await ingest(
      'Some content to process',
      'chat',
      { sessionId: 'sess', userId: 'user', conversationHistory: [] }
    );

    expect(result.processingTimeMs).toBeGreaterThan(0);
    expect(result.processingTimeMs).toBeLessThan(1000); // Should be fast
  });
});
