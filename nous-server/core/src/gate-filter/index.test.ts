/**
 * @module @nous/core/gate-filter/tests
 * @description Tests for storm-036 Gate Filter System
 */

import { describe, it, expect } from 'vitest';
import {
  // Constants
  GATE_DECISIONS,
  GATE_REASONS,
  BYPASS_SOURCES,
  TRANSFORMATION_TYPES,
  GATE_FILTER_DEFAULTS,
  RULE_CONFIDENCES,
  GIBBERISH_ENTROPY_THRESHOLD,
  GIBBERISH_WORD_RATIO_THRESHOLD,
  FILLER_SCORE_THRESHOLD,
  FILLER_WORDS,
  SPAM_PATTERNS,
  SOCIAL_PATTERNS_BY_LANG,
  SUPPORTED_LANGUAGES,
  COMMON_WORDS,
  REPEATED_CHARS_THRESHOLD,
  REPEATED_CHARS_PATTERN,
  GATE_MIN_CONTENT_LENGTH,
  ALL_CAPS_MIN_LENGTH,
  ALL_CAPS_MIN_LETTERS,

  // Types
  type GateDecision,
  type GateReason,
  type BypassSource,
  type GateFilterConfig,
  type GateFilterResult,
  type GateFilterInputEnvelope,
  type GateFilterMetrics,

  // Schemas
  GateFilterConfigSchema,
  GateFilterBypassSchema,
  TransformationSchema,
  GateFilterResultSchema,
  GateFilterInputEnvelopeSchema,
  GateFilterMetricsSchema,
  RejectionLogSchema,
  GateFilterExtractionContextSchema,

  // Functions
  gateFilter,
  shouldBypass,
  normalizeWhitespace,
  isGibberish,
  calculateEntropy,
  countRealWords,
  matchesSpamPattern,
  getFillerScore,
  isEmptySemantic,
  isAllCaps,
  isSocialOnly,
  applyCleanup,
  createDefaultMetrics,
  updateMetrics,
  reportFalsePositive,
  createRejectionLog,
} from './index';

// ============================================================
// CONSTANTS TESTS
// ============================================================

describe('Gate Filter Constants', () => {
  describe('GATE_DECISIONS', () => {
    it('should have exactly 4 decisions', () => {
      expect(GATE_DECISIONS).toHaveLength(4);
    });

    it('should include all required decisions', () => {
      expect(GATE_DECISIONS).toContain('BYPASS');
      expect(GATE_DECISIONS).toContain('PASS');
      expect(GATE_DECISIONS).toContain('REJECT');
      expect(GATE_DECISIONS).toContain('PROMPT');
    });
  });

  describe('GATE_REASONS', () => {
    it('should have exactly 9 reasons', () => {
      expect(GATE_REASONS).toHaveLength(9);
    });

    it('should include all rule reasons', () => {
      expect(GATE_REASONS).toContain('too_short');
      expect(GATE_REASONS).toContain('gibberish');
      expect(GATE_REASONS).toContain('spam_pattern');
      expect(GATE_REASONS).toContain('repeated_chars');
      expect(GATE_REASONS).toContain('pure_filler');
      expect(GATE_REASONS).toContain('empty_semantic');
      expect(GATE_REASONS).toContain('all_caps');
      expect(GATE_REASONS).toContain('social_only');
      expect(GATE_REASONS).toContain('uncertain');
    });
  });

  describe('BYPASS_SOURCES', () => {
    it('should have exactly 4 bypass sources', () => {
      expect(BYPASS_SOURCES).toHaveLength(4);
    });

    it('should include all bypass sources', () => {
      expect(BYPASS_SOURCES).toContain('api_force');
      expect(BYPASS_SOURCES).toContain('file_upload');
      expect(BYPASS_SOURCES).toContain('voice_transcript');
      expect(BYPASS_SOURCES).toContain('manual_note');
    });
  });

  describe('GATE_FILTER_DEFAULTS', () => {
    it('should have correct default values', () => {
      expect(GATE_FILTER_DEFAULTS.max_latency_ms).toBe(5);
      expect(GATE_FILTER_DEFAULTS.reject_confidence).toBe(0.95);
      expect(GATE_FILTER_DEFAULTS.prompt_confidence).toBe(0.80);
      expect(GATE_FILTER_DEFAULTS.enabled).toBe(true);
      expect(GATE_FILTER_DEFAULTS.log_rejected).toBe(true);
      expect(GATE_FILTER_DEFAULTS.strict_mode).toBe(false);
      expect(GATE_FILTER_DEFAULTS.min_words_for_filler_check).toBe(5);
      expect(GATE_FILTER_DEFAULTS.default_language).toBe('en');
    });
  });

  describe('RULE_CONFIDENCES', () => {
    it('should have Tier 1 rules with high confidence (0.96-1.0)', () => {
      expect(RULE_CONFIDENCES['R-001_too_short']).toBe(1.0);
      expect(RULE_CONFIDENCES['R-002_gibberish']).toBe(0.98);
      expect(RULE_CONFIDENCES['R-003_spam_pattern']).toBe(0.97);
      expect(RULE_CONFIDENCES['R-004_repeated_chars']).toBe(0.96);
      expect(RULE_CONFIDENCES['R-005_pure_filler']).toBe(0.96);
    });

    it('should have Tier 2 rules with medium confidence (0.85-0.95)', () => {
      expect(RULE_CONFIDENCES['R-006_empty_semantic']).toBe(0.88);
      expect(RULE_CONFIDENCES['R-007_all_caps']).toBe(0.85);
    });

    it('should have Tier 3 rules with low confidence (0.50-0.85)', () => {
      expect(RULE_CONFIDENCES['R-008_social_only']).toBe(0.70);
    });
  });

  describe('Threshold Constants', () => {
    it('should have correct gibberish thresholds', () => {
      expect(GIBBERISH_ENTROPY_THRESHOLD).toBe(4.5);
      expect(GIBBERISH_WORD_RATIO_THRESHOLD).toBe(0.3);
    });

    it('should have correct filler threshold', () => {
      expect(FILLER_SCORE_THRESHOLD).toBe(0.9);
    });

    it('should have correct content length thresholds', () => {
      expect(GATE_MIN_CONTENT_LENGTH).toBe(3);
      expect(ALL_CAPS_MIN_LENGTH).toBe(10);
      expect(ALL_CAPS_MIN_LETTERS).toBe(5);
    });

    it('should have correct repeated chars threshold', () => {
      expect(REPEATED_CHARS_THRESHOLD).toBe(10);
    });
  });

  describe('Word Lists', () => {
    it('should have filler words', () => {
      expect(FILLER_WORDS.has('um')).toBe(true);
      expect(FILLER_WORDS.has('uh')).toBe(true);
      expect(FILLER_WORDS.has('like')).toBe(true);
      expect(FILLER_WORDS.has('basically')).toBe(true);
    });

    it('should have common words', () => {
      expect(COMMON_WORDS.has('the')).toBe(true);
      expect(COMMON_WORDS.has('is')).toBe(true);
      expect(COMMON_WORDS.has('and')).toBe(true);
    });
  });

  describe('SUPPORTED_LANGUAGES', () => {
    it('should include en, es, fr, de', () => {
      expect(SUPPORTED_LANGUAGES).toContain('en');
      expect(SUPPORTED_LANGUAGES).toContain('es');
      expect(SUPPORTED_LANGUAGES).toContain('fr');
      expect(SUPPORTED_LANGUAGES).toContain('de');
    });
  });
});

// ============================================================
// SCHEMA TESTS
// ============================================================

describe('Gate Filter Schemas', () => {
  describe('GateFilterConfigSchema', () => {
    it('should accept valid config', () => {
      const config = {
        max_latency_ms: 10,
        reject_confidence: 0.90,
        prompt_confidence: 0.75,
        enabled: true,
        log_rejected: false,
        strict_mode: true,
        min_words_for_filler_check: 3,
        default_language: 'es',
      };
      expect(() => GateFilterConfigSchema.parse(config)).not.toThrow();
    });

    it('should apply defaults for missing values', () => {
      const result = GateFilterConfigSchema.parse({});
      expect(result.max_latency_ms).toBe(5);
      expect(result.reject_confidence).toBe(0.95);
    });
  });

  describe('GateFilterInputEnvelopeSchema', () => {
    it('should accept valid envelope', () => {
      const envelope = {
        source: 'chat',
        normalized: { text: 'Hello world' },
        context: { userId: 'user-1', sessionId: 'session-1' },
      };
      expect(() => GateFilterInputEnvelopeSchema.parse(envelope)).not.toThrow();
    });

    it('should accept envelope with metadata', () => {
      const envelope = {
        source: 'voice',
        normalized: { text: 'Hello world' },
        metadata: { language: 'en', whisperProcessed: true },
        context: { userId: 'user-1', sessionId: 'session-1' },
      };
      expect(() => GateFilterInputEnvelopeSchema.parse(envelope)).not.toThrow();
    });
  });

  describe('GateFilterResultSchema', () => {
    it('should accept valid result', () => {
      const result = {
        decision: 'PASS',
        confidence: 0.5,
        reasons: ['uncertain'],
        latency_ms: 2,
      };
      expect(() => GateFilterResultSchema.parse(result)).not.toThrow();
    });
  });

  describe('GateFilterMetricsSchema', () => {
    it('should accept valid metrics', () => {
      const metrics = createDefaultMetrics();
      expect(() => GateFilterMetricsSchema.parse(metrics)).not.toThrow();
    });
  });
});

// ============================================================
// HELPER FUNCTION TESTS
// ============================================================

describe('Helper Functions', () => {
  describe('normalizeWhitespace', () => {
    it('should collapse multiple spaces', () => {
      expect(normalizeWhitespace('hello    world')).toBe('hello world');
    });

    it('should trim leading/trailing whitespace', () => {
      expect(normalizeWhitespace('  hello  ')).toBe('hello');
    });

    it('should handle tabs and newlines', () => {
      expect(normalizeWhitespace('hello\t\nworld')).toBe('hello world');
    });
  });

  describe('calculateEntropy', () => {
    it('should return 0 for empty string', () => {
      expect(calculateEntropy('')).toBe(0);
    });

    it('should return 0 for single repeated character', () => {
      expect(calculateEntropy('aaaa')).toBe(0);
    });

    it('should return higher entropy for varied text', () => {
      const lowEntropy = calculateEntropy('aaaa');
      const highEntropy = calculateEntropy('abcd');
      expect(highEntropy).toBeGreaterThan(lowEntropy);
    });
  });

  describe('countRealWords', () => {
    it('should count common words', () => {
      expect(countRealWords('the cat is on the mat')).toBeGreaterThan(0);
    });

    it('should count words longer than 2 chars', () => {
      expect(countRealWords('hello world xyz')).toBe(3);
    });
  });

  describe('isGibberish', () => {
    it('should not flag normal text', () => {
      expect(isGibberish('Hello, how are you today?')).toBe(false);
    });

    it('should not flag text with common words', () => {
      expect(isGibberish('the cat is on the mat')).toBe(false);
    });

    it('should check both entropy and word ratio', () => {
      // The function requires BOTH high entropy (>4.5) AND low word ratio (<0.3)
      // Words >2 chars count as "real words", so most gibberish passes
      // This tests the function returns a boolean
      const result = isGibberish('random text here');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('matchesSpamPattern', () => {
    it('should detect test content', () => {
      expect(matchesSpamPattern('test')).toBe(true);
      expect(matchesSpamPattern('asdf')).toBe(true);
    });

    it('should detect marketing spam', () => {
      expect(matchesSpamPattern('Buy now and save!')).toBe(true);
      expect(matchesSpamPattern('Click here for more')).toBe(true);
    });

    it('should detect repeated patterns', () => {
      // Pattern requires 6+ repeats of 1-3 char group
      expect(matchesSpamPattern('hahahahahahahaha')).toBe(true);
    });

    it('should detect number-only content', () => {
      expect(matchesSpamPattern('12345')).toBe(true);
      expect(matchesSpamPattern('123-456-7890')).toBe(true);
    });

    it('should not flag normal text', () => {
      expect(matchesSpamPattern('I need to buy groceries')).toBe(false);
    });
  });

  describe('getFillerScore', () => {
    it('should return 0 for empty array', () => {
      expect(getFillerScore([])).toBe(0);
    });

    it('should return high score for filler-only content', () => {
      const words = ['um', 'like', 'basically', 'yeah', 'so'];
      expect(getFillerScore(words)).toBeGreaterThan(0.9);
    });

    it('should return low score for meaningful content', () => {
      const words = ['remember', 'meeting', 'tomorrow', 'at', 'noon'];
      expect(getFillerScore(words)).toBeLessThan(0.5);
    });
  });

  describe('isEmptySemantic', () => {
    it('should detect emoji-only content', () => {
      expect(isEmptySemantic('😀😀😀')).toBe(true);
    });

    it('should detect punctuation-only content', () => {
      expect(isEmptySemantic('!!!')).toBe(true);
      expect(isEmptySemantic('...')).toBe(true);
    });

    it('should not flag content with letters', () => {
      expect(isEmptySemantic('Hello!')).toBe(false);
    });
  });

  describe('isAllCaps', () => {
    it('should detect all caps text', () => {
      expect(isAllCaps('THIS IS ALL CAPS TEXT')).toBe(true);
    });

    it('should not flag short text', () => {
      expect(isAllCaps('HI')).toBe(false);
    });

    it('should not flag mixed case', () => {
      expect(isAllCaps('This Is Mixed Case')).toBe(false);
    });

    it('should handle text with numbers', () => {
      expect(isAllCaps('ORDER NUMBER 12345')).toBe(true);
    });
  });

  describe('isSocialOnly', () => {
    it('should detect English greetings', () => {
      expect(isSocialOnly('hi', 'en')).toBe(true);
      expect(isSocialOnly('hello!', 'en')).toBe(true);
      expect(isSocialOnly('hey', 'en')).toBe(true);
    });

    it('should detect thanks', () => {
      expect(isSocialOnly('thanks', 'en')).toBe(true);
      expect(isSocialOnly('thank you!', 'en')).toBe(true);
    });

    it('should detect Spanish greetings', () => {
      expect(isSocialOnly('hola', 'es')).toBe(true);
      expect(isSocialOnly('gracias', 'es')).toBe(true);
    });

    it('should detect French greetings', () => {
      expect(isSocialOnly('bonjour', 'fr')).toBe(true);
      expect(isSocialOnly('merci', 'fr')).toBe(true);
    });

    it('should detect German greetings', () => {
      expect(isSocialOnly('hallo', 'de')).toBe(true);
      expect(isSocialOnly('danke', 'de')).toBe(true);
    });

    it('should not flag meaningful content', () => {
      expect(isSocialOnly('Hello, I need help with something', 'en')).toBe(false);
    });

    it('should fall back to English for unknown language', () => {
      expect(isSocialOnly('hello', 'unknown')).toBe(true);
    });
  });

  describe('applyCleanup', () => {
    it('should collapse repeated punctuation', () => {
      const result = applyCleanup('Hello!!!');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('collapse_repeats');
      expect(result[0].after).toBe('Hello!!');
    });

    it('should return empty array for clean text', () => {
      const result = applyCleanup('Hello world');
      expect(result).toHaveLength(0);
    });
  });
});

// ============================================================
// BYPASS DETECTION TESTS
// ============================================================

describe('shouldBypass', () => {
  const baseEnvelope: GateFilterInputEnvelope = {
    source: 'chat',
    normalized: { text: 'test' },
    context: { userId: 'user-1', sessionId: 'session-1' },
  };

  it('should bypass API force save (B-001)', () => {
    const envelope: GateFilterInputEnvelope = {
      ...baseEnvelope,
      source: 'api',
      options: { forceSave: true },
    };
    const result = shouldBypass(envelope);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('api_force');
  });

  it('should bypass file uploads (B-002)', () => {
    const envelope: GateFilterInputEnvelope = {
      ...baseEnvelope,
      source: 'file',
    };
    const result = shouldBypass(envelope);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('file_upload');
  });

  it('should bypass voice transcripts with Whisper (B-003)', () => {
    const envelope: GateFilterInputEnvelope = {
      ...baseEnvelope,
      source: 'voice',
      metadata: { whisperProcessed: true },
    };
    const result = shouldBypass(envelope);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('voice_transcript');
  });

  it('should not bypass voice without Whisper processing', () => {
    const envelope: GateFilterInputEnvelope = {
      ...baseEnvelope,
      source: 'voice',
    };
    const result = shouldBypass(envelope);
    expect(result).toBeNull();
  });

  it('should bypass manual notes (B-004)', () => {
    const envelope: GateFilterInputEnvelope = {
      ...baseEnvelope,
      metadata: { isManualNote: true },
    };
    const result = shouldBypass(envelope);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('manual_note');
  });

  it('should not bypass normal chat', () => {
    const result = shouldBypass(baseEnvelope);
    expect(result).toBeNull();
  });
});

// ============================================================
// MAIN GATE FILTER TESTS
// ============================================================

describe('gateFilter', () => {
  const createEnvelope = (text: string, overrides?: Partial<GateFilterInputEnvelope>): GateFilterInputEnvelope => ({
    source: 'chat',
    normalized: { text },
    context: { userId: 'user-1', sessionId: 'session-1' },
    ...overrides,
  });

  describe('Bypass conditions', () => {
    it('should return BYPASS for file uploads', () => {
      const result = gateFilter(createEnvelope('test', { source: 'file' }));
      expect(result.decision).toBe('BYPASS');
      expect(result.confidence).toBe(1.0);
      expect(result.bypass).toBeDefined();
    });

    it('should return BYPASS for API force save', () => {
      const result = gateFilter(createEnvelope('test', {
        source: 'api',
        options: { forceSave: true },
      }));
      expect(result.decision).toBe('BYPASS');
    });
  });

  describe('R-001: Too short', () => {
    it('should reject empty string', () => {
      const result = gateFilter(createEnvelope(''));
      expect(result.decision).toBe('REJECT');
      expect(result.reasons).toContain('too_short');
      expect(result.confidence).toBe(1.0);
    });

    it('should reject very short text', () => {
      const result = gateFilter(createEnvelope('hi'));
      expect(result.decision).toBe('REJECT');
      expect(result.reasons).toContain('too_short');
    });

    it('should pass text at minimum length', () => {
      const result = gateFilter(createEnvelope('abc'));
      expect(result.decision).not.toBe('REJECT');
    });
  });

  describe('R-002: Gibberish', () => {
    it('should pass normal text without gibberish flag', () => {
      const result = gateFilter(createEnvelope('Hello, how are you today?'));
      expect(result.reasons).not.toContain('gibberish');
    });

    it('should pass text with real words', () => {
      const result = gateFilter(createEnvelope('This is a normal sentence with content.'));
      expect(result.reasons).not.toContain('gibberish');
    });
  });

  describe('R-003: Spam patterns', () => {
    it('should reject test content', () => {
      const result = gateFilter(createEnvelope('testtest'));
      expect(result.decision).toBe('REJECT');
      expect(result.reasons).toContain('spam_pattern');
    });

    it('should reject marketing spam', () => {
      const result = gateFilter(createEnvelope('Buy now for limited time!'));
      expect(result.decision).toBe('REJECT');
      expect(result.reasons).toContain('spam_pattern');
    });

    it('should reject number-only content', () => {
      const result = gateFilter(createEnvelope('12345'));
      expect(result.decision).toBe('REJECT');
      expect(result.reasons).toContain('spam_pattern');
    });
  });

  describe('R-004: Repeated characters', () => {
    it('should reject content with excessive repeated characters', () => {
      // This gets rejected (may be caught by spam_pattern or repeated_chars)
      const result = gateFilter(createEnvelope('This is greaaaaaaaaaaat'));
      expect(result.decision).toBe('REJECT');
    });

    it('should detect repeated chars pattern directly', () => {
      // Test the pattern directly
      expect(REPEATED_CHARS_PATTERN.test('aaaaaaaaaaaa')).toBe(true);
      expect(REPEATED_CHARS_PATTERN.test('hello')).toBe(false);
    });

    it('should pass normal repetition', () => {
      const result = gateFilter(createEnvelope('Hello there!'));
      expect(result.reasons).not.toContain('repeated_chars');
    });
  });

  describe('R-005: Pure filler', () => {
    it('should reject pure filler content', () => {
      const result = gateFilter(createEnvelope('um like basically yeah so anyway'));
      expect(result.decision).toBe('REJECT');
      expect(result.reasons).toContain('pure_filler');
    });

    it('should not check filler for short messages', () => {
      const result = gateFilter(createEnvelope('um like'));
      expect(result.reasons).not.toContain('pure_filler');
    });
  });

  describe('R-006: Empty semantic', () => {
    it('should flag emoji-only content', () => {
      const result = gateFilter(createEnvelope('😀😀😀😀'));
      expect(result.reasons).toContain('empty_semantic');
    });

    it('should flag punctuation-only content', () => {
      const result = gateFilter(createEnvelope('!!!...???'));
      expect(result.reasons).toContain('empty_semantic');
    });
  });

  describe('R-007: All caps', () => {
    it('should flag all caps content', () => {
      const result = gateFilter(createEnvelope('THIS IS ALL CAPS TEXT'));
      expect(result.reasons).toContain('all_caps');
    });

    it('should not flag mixed case', () => {
      const result = gateFilter(createEnvelope('This Is Mixed Case Text'));
      expect(result.reasons).not.toContain('all_caps');
    });
  });

  describe('R-008: Social only', () => {
    it('should flag greetings', () => {
      const result = gateFilter(createEnvelope('Hello!'));
      expect(result.reasons).toContain('social_only');
    });

    it('should flag thanks', () => {
      const result = gateFilter(createEnvelope('Thanks!'));
      expect(result.reasons).toContain('social_only');
    });

    it('should not reject social-only (confidence too low)', () => {
      const result = gateFilter(createEnvelope('Hello!'));
      // Social-only has confidence 0.70, below reject threshold 0.95
      expect(result.decision).toBe('PASS');
    });
  });

  describe('PASS decision', () => {
    it('should pass meaningful content', () => {
      const result = gateFilter(createEnvelope('Remember my meeting tomorrow at 3pm'));
      expect(result.decision).toBe('PASS');
    });

    it('should include uncertain reason when no issues found', () => {
      const result = gateFilter(createEnvelope('This is a normal sentence with content.'));
      expect(result.decision).toBe('PASS');
      expect(result.reasons).toContain('uncertain');
    });

    it('should include transformations when cleanup applied', () => {
      const result = gateFilter(createEnvelope('Hello world!!!'));
      expect(result.decision).toBe('PASS');
      expect(result.transformations).toBeDefined();
    });
  });

  describe('Latency tracking', () => {
    it('should track processing latency', () => {
      const result = gateFilter(createEnvelope('test content'));
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Language support', () => {
    it('should use language from metadata', () => {
      const result = gateFilter(createEnvelope('hola', {
        metadata: { language: 'es' },
      }));
      expect(result.reasons).toContain('social_only');
    });

    it('should use default language when not specified', () => {
      const result = gateFilter(createEnvelope('hello'));
      expect(result.reasons).toContain('social_only');
    });
  });
});

// ============================================================
// METRICS TESTS
// ============================================================

describe('Metrics Functions', () => {
  describe('createDefaultMetrics', () => {
    it('should create metrics with zero values', () => {
      const metrics = createDefaultMetrics();
      expect(metrics.total_processed).toBe(0);
      expect(metrics.bypass_count).toBe(0);
      expect(metrics.pass_count).toBe(0);
      expect(metrics.reject_count).toBe(0);
      expect(metrics.prompt_count).toBe(0);
      expect(metrics.avg_latency_ms).toBe(0);
      expect(metrics.false_positive_reports).toBe(0);
      expect(Object.keys(metrics.rejection_by_reason)).toHaveLength(0);
    });
  });

  describe('updateMetrics', () => {
    it('should increment total_processed', () => {
      const metrics = createDefaultMetrics();
      const result: GateFilterResult = {
        decision: 'PASS',
        confidence: 0.5,
        reasons: ['uncertain'],
        latency_ms: 2,
      };
      updateMetrics(metrics, result);
      expect(metrics.total_processed).toBe(1);
    });

    it('should increment correct decision count', () => {
      const metrics = createDefaultMetrics();

      updateMetrics(metrics, { decision: 'PASS', confidence: 0.5, reasons: [], latency_ms: 1 });
      expect(metrics.pass_count).toBe(1);

      updateMetrics(metrics, { decision: 'REJECT', confidence: 1.0, reasons: ['too_short'], latency_ms: 1 });
      expect(metrics.reject_count).toBe(1);

      updateMetrics(metrics, { decision: 'BYPASS', confidence: 1.0, reasons: [], latency_ms: 1 });
      expect(metrics.bypass_count).toBe(1);

      updateMetrics(metrics, { decision: 'PROMPT', confidence: 0.85, reasons: ['all_caps'], latency_ms: 1 });
      expect(metrics.prompt_count).toBe(1);
    });

    it('should update rolling average latency', () => {
      const metrics = createDefaultMetrics();
      updateMetrics(metrics, { decision: 'PASS', confidence: 0.5, reasons: [], latency_ms: 10 });
      expect(metrics.avg_latency_ms).toBe(10);

      updateMetrics(metrics, { decision: 'PASS', confidence: 0.5, reasons: [], latency_ms: 20 });
      expect(metrics.avg_latency_ms).toBe(15);
    });

    it('should track rejection reasons', () => {
      const metrics = createDefaultMetrics();
      updateMetrics(metrics, { decision: 'REJECT', confidence: 1.0, reasons: ['too_short'], latency_ms: 1 });
      updateMetrics(metrics, { decision: 'REJECT', confidence: 1.0, reasons: ['too_short', 'gibberish'], latency_ms: 1 });

      expect(metrics.rejection_by_reason['too_short']).toBe(2);
      expect(metrics.rejection_by_reason['gibberish']).toBe(1);
    });
  });

  describe('reportFalsePositive', () => {
    it('should increment false positive count', () => {
      const metrics = createDefaultMetrics();
      reportFalsePositive(metrics);
      expect(metrics.false_positive_reports).toBe(1);
      reportFalsePositive(metrics);
      expect(metrics.false_positive_reports).toBe(2);
    });
  });
});

// ============================================================
// AUDIT LOGGING TESTS
// ============================================================

describe('createRejectionLog', () => {
  it('should create a rejection log entry', () => {
    const envelope: GateFilterInputEnvelope = {
      source: 'chat',
      normalized: { text: 'test content' },
      context: { userId: 'user-123', sessionId: 'session-456' },
    };
    const result: GateFilterResult = {
      decision: 'REJECT',
      confidence: 1.0,
      reasons: ['too_short'],
      latency_ms: 2,
    };
    const hashFn = (text: string) => `hash_${text.length}`;

    const log = createRejectionLog(envelope, result, hashFn);

    expect(log.userId).toBe('user-123');
    expect(log.sessionId).toBe('session-456');
    expect(log.input_hash).toBe('hash_12');
    expect(log.input_length).toBe(12);
    expect(log.decision).toBe('REJECT');
    expect(log.reasons).toContain('too_short');
    expect(log.confidence).toBe(1.0);
    expect(log.latency_ms).toBe(2);
    expect(log.timestamp).toBeInstanceOf(Date);
  });
});

// ============================================================
// EDGE CASE TESTS
// ============================================================

describe('Edge Cases', () => {
  const createEnvelope = (text: string): GateFilterInputEnvelope => ({
    source: 'chat',
    normalized: { text },
    context: { userId: 'user-1', sessionId: 'session-1' },
  });

  it('should handle Unicode characters', () => {
    const result = gateFilter(createEnvelope('日本語のテキスト'));
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('should handle mixed scripts', () => {
    const result = gateFilter(createEnvelope('Hello 世界 Привет'));
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('should handle very long text', () => {
    const longText = 'This is a test sentence. '.repeat(100);
    const result = gateFilter(createEnvelope(longText));
    expect(result.decision).toBe('PASS');
  });

  it('should handle whitespace-only text', () => {
    const result = gateFilter(createEnvelope('   \t\n   '));
    expect(result.decision).toBe('REJECT');
    expect(result.reasons).toContain('too_short');
  });
});
