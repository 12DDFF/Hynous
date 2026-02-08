/**
 * @module @nous/core/tps tests
 * @description Tests for Temporal Parsing System
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Constants
  EXPRESSION_TYPES,
  TIME_SOURCES,
  SOURCE_CONFIDENCE,
  GRANULARITY_CONFIDENCE,
  INTERPRETATION_CONFIDENCE,
  SEASONS,
  QUERY_STEP_BUDGETS,
  PHASE_1_BUDGET_MS,

  // Types
  type ExpressionType,
  type TimeSource,
  type ConfidenceFactors,
  type TPSInput,
  type TPSOutput,
  type TemporalConstraint,

  // Functions
  computeConfidenceScore,
  getSourceConfidence,
  getGranularityConfidence,
  getInterpretationConfidence,
  parseTemporalExpression,
  parseRelativeTime,
  parseAbsoluteMonth,
  parseFuzzyTime,
  detectSeason,
  getSeasonRange,
  isWithinBudget,
  validateTPSInput,
  validateTPSOutput,
  validateTemporalConstraint,
} from './index';

describe('tps/constants', () => {
  describe('EXPRESSION_TYPES', () => {
    it('should have all expression types', () => {
      expect(EXPRESSION_TYPES).toContain('explicit_absolute');
      expect(EXPRESSION_TYPES).toContain('explicit_relative');
      expect(EXPRESSION_TYPES).toContain('fuzzy_period');
      expect(EXPRESSION_TYPES).toContain('duration');
      expect(EXPRESSION_TYPES).toContain('none');
    });
  });

  describe('TIME_SOURCES', () => {
    it('should have all time sources', () => {
      expect(TIME_SOURCES).toContain('user_explicit');
      expect(TIME_SOURCES).toContain('calendar_sync');
      expect(TIME_SOURCES).toContain('file_timestamp');
      expect(TIME_SOURCES).toContain('content_extraction');
      expect(TIME_SOURCES).toContain('context_inference');
      expect(TIME_SOURCES).toContain('unknown');
    });
  });

  describe('SOURCE_CONFIDENCE', () => {
    it('should have correct confidence values', () => {
      expect(SOURCE_CONFIDENCE.user_explicit).toBe(1.0);
      expect(SOURCE_CONFIDENCE.calendar_sync).toBe(0.95);
      expect(SOURCE_CONFIDENCE.unknown).toBe(0.3);
    });
  });

  describe('GRANULARITY_CONFIDENCE', () => {
    it('should have correct confidence values', () => {
      expect(GRANULARITY_CONFIDENCE.minute).toBe(1.0);
      expect(GRANULARITY_CONFIDENCE.hour).toBe(0.9);
      expect(GRANULARITY_CONFIDENCE.day).toBe(0.8);
      expect(GRANULARITY_CONFIDENCE.month).toBe(0.4);
    });
  });

  describe('SEASONS', () => {
    it('should have all seasons defined', () => {
      expect(SEASONS.spring).toBeDefined();
      expect(SEASONS.summer).toBeDefined();
      expect(SEASONS.fall).toBeDefined();
      expect(SEASONS.autumn).toBeDefined();
      expect(SEASONS.winter).toBeDefined();
    });

    it('should have correct summer range', () => {
      expect(SEASONS.summer.startMonth).toBe(6);
      expect(SEASONS.summer.endMonth).toBe(8);
    });
  });

  describe('QUERY_STEP_BUDGETS', () => {
    it('should have all step budgets', () => {
      expect(QUERY_STEP_BUDGETS.temporalParsing).toBe(5);
      expect(QUERY_STEP_BUDGETS.entityExtraction).toBe(3);
      expect(QUERY_STEP_BUDGETS.episodeFilter).toBe(10);
      expect(QUERY_STEP_BUDGETS.semanticFilter).toBe(30);
    });
  });
});

describe('tps/confidence', () => {
  describe('computeConfidenceScore', () => {
    it('should calculate combined confidence', () => {
      const factors: ConfidenceFactors = {
        source: 0.95,
        granularity: 0.8,
        interpretation: 1.0,
      };
      expect(computeConfidenceScore(factors)).toBeCloseTo(0.76, 2);
    });

    it('should return 1.0 for perfect confidence', () => {
      const factors: ConfidenceFactors = {
        source: 1.0,
        granularity: 1.0,
        interpretation: 1.0,
      };
      expect(computeConfidenceScore(factors)).toBe(1.0);
    });
  });

  describe('getSourceConfidence', () => {
    it('should return correct confidence for each source', () => {
      expect(getSourceConfidence('user_explicit')).toBe(1.0);
      expect(getSourceConfidence('calendar_sync')).toBe(0.95);
      expect(getSourceConfidence('unknown')).toBe(0.3);
    });
  });

  describe('getGranularityConfidence', () => {
    it('should return correct confidence for each granularity', () => {
      expect(getGranularityConfidence('minute')).toBe(1.0);
      expect(getGranularityConfidence('day')).toBe(0.8);
      expect(getGranularityConfidence('year')).toBe(0.2);
    });
  });

  describe('getInterpretationConfidence', () => {
    it('should return correct confidence for each type', () => {
      expect(getInterpretationConfidence('explicit_absolute')).toBe(1.0);
      expect(getInterpretationConfidence('explicit_relative')).toBe(0.95);
      expect(getInterpretationConfidence('fuzzy_period')).toBe(0.6);
    });
  });
});

describe('tps/seasons', () => {
  describe('detectSeason', () => {
    it('should detect season in query', () => {
      expect(detectSeason('What happened in summer?')).toBe('summer');
      expect(detectSeason('around winter time')).toBe('winter');
      expect(detectSeason('during fall semester')).toBe('fall');
    });

    it('should return null if no season', () => {
      expect(detectSeason('What happened yesterday?')).toBeNull();
      expect(detectSeason('Last week')).toBeNull();
    });
  });

  describe('getSeasonRange', () => {
    it('should return correct range for summer', () => {
      const range = getSeasonRange('summer', 2024);
      expect(range).not.toBeNull();
      expect(range!.start.getUTCMonth()).toBe(5); // June (0-indexed)
      expect(range!.end.getUTCMonth()).toBe(7); // August
    });

    it('should handle winter spanning years', () => {
      const range = getSeasonRange('winter', 2024);
      expect(range).not.toBeNull();
      expect(range!.start.getUTCMonth()).toBe(11); // December
      expect(range!.end.getUTCFullYear()).toBe(2025);
    });

    it('should return null for invalid season', () => {
      expect(getSeasonRange('invalid', 2024)).toBeNull();
    });
  });
});

describe('tps/parsing', () => {
  const referenceDate = new Date('2025-01-15T10:00:00Z');

  describe('parseRelativeTime', () => {
    it('should parse "yesterday"', () => {
      const result = parseRelativeTime('yesterday', referenceDate);
      expect(result).not.toBeNull();
      expect(result!.expression).toBe('yesterday');
      expect(result!.start.getDate()).toBe(14);
    });

    it('should parse "last week"', () => {
      const result = parseRelativeTime('last week', referenceDate);
      expect(result).not.toBeNull();
      expect(result!.expression).toBe('last week');
    });

    it('should parse "3 days ago"', () => {
      const result = parseRelativeTime('3 days ago', referenceDate);
      expect(result).not.toBeNull();
      expect(result!.start.getDate()).toBe(12);
    });

    it('should parse "2 weeks ago"', () => {
      const result = parseRelativeTime('2 weeks ago', referenceDate);
      expect(result).not.toBeNull();
    });

    it('should return null for non-relative expressions', () => {
      expect(parseRelativeTime('September', referenceDate)).toBeNull();
    });
  });

  describe('parseAbsoluteMonth', () => {
    it('should parse "September"', () => {
      const result = parseAbsoluteMonth('in September', referenceDate);
      expect(result).not.toBeNull();
      expect(result!.start.getUTCMonth()).toBe(8); // September
      // Should be 2024 since September 2025 is in the future
      expect(result!.start.getUTCFullYear()).toBe(2024);
    });

    it('should parse "January 2024"', () => {
      const result = parseAbsoluteMonth('in January 2024', referenceDate);
      expect(result).not.toBeNull();
      expect(result!.start.getUTCMonth()).toBe(0);
      expect(result!.start.getUTCFullYear()).toBe(2024);
    });

    it('should parse month abbreviations', () => {
      const result = parseAbsoluteMonth('in Sep', referenceDate);
      expect(result).not.toBeNull();
      expect(result!.start.getUTCMonth()).toBe(8);
    });

    it('should return null for non-month expressions', () => {
      expect(parseAbsoluteMonth('yesterday', referenceDate)).toBeNull();
    });
  });

  describe('parseFuzzyTime', () => {
    it('should parse "recently"', () => {
      const result = parseFuzzyTime('recently', referenceDate);
      expect(result).not.toBeNull();
      expect(result!.expression).toBe('recently');
      expect(result!.confidence).toBe(0.7);
    });

    it('should parse "a while back"', () => {
      const result = parseFuzzyTime('a while back', referenceDate);
      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(0.4);
    });

    it('should parse season references', () => {
      const result = parseFuzzyTime('around summer', referenceDate);
      expect(result).not.toBeNull();
      expect(result!.expression).toBe('summer');
      expect(result!.confidence).toBe(0.6);
    });
  });
});

describe('tps/parseTemporalExpression', () => {
  describe('relative expressions', () => {
    it('should parse relative time correctly', () => {
      const input: TPSInput = {
        query: 'What did I learn yesterday?',
        referenceTimestamp: '2025-01-15T10:00:00Z',
        userTimezone: 'America/New_York',
      };
      const result = parseTemporalExpression(input);

      expect(result.temporalConstraint).not.toBeNull();
      expect(result.temporalConstraint!.expressionType).toBe('explicit_relative');
      expect(result.parsingConfidence).toBe(0.95);
    });
  });

  describe('absolute expressions', () => {
    it('should parse absolute month correctly', () => {
      const input: TPSInput = {
        query: 'What happened in September?',
        referenceTimestamp: '2025-01-15T10:00:00Z',
        userTimezone: 'America/New_York',
      };
      const result = parseTemporalExpression(input);

      expect(result.temporalConstraint).not.toBeNull();
      expect(result.temporalConstraint!.expressionType).toBe('explicit_absolute');
      expect(result.parsingConfidence).toBe(1.0);
    });
  });

  describe('fuzzy expressions', () => {
    it('should parse fuzzy time correctly', () => {
      const input: TPSInput = {
        query: 'What did I do around summer?',
        referenceTimestamp: '2025-01-15T10:00:00Z',
        userTimezone: 'America/New_York',
      };
      const result = parseTemporalExpression(input);

      expect(result.temporalConstraint).not.toBeNull();
      expect(result.temporalConstraint!.expressionType).toBe('fuzzy_period');
      expect(result.parsingConfidence).toBe(0.6);
    });
  });

  describe('no temporal expression', () => {
    it('should return null constraint when no time in query', () => {
      const input: TPSInput = {
        query: 'What is machine learning?',
        referenceTimestamp: '2025-01-15T10:00:00Z',
        userTimezone: 'America/New_York',
      };
      const result = parseTemporalExpression(input);

      expect(result.temporalConstraint).toBeNull();
      expect(result.parsingConfidence).toBe(1.0);
      expect(result.entitiesExtracted).toContain('machine');
      expect(result.entitiesExtracted).toContain('learning');
    });
  });

  describe('entity extraction', () => {
    it('should extract non-temporal entities', () => {
      const input: TPSInput = {
        query: 'What did Prof. Dave teach about Fourier in September?',
        referenceTimestamp: '2025-01-15T10:00:00Z',
        userTimezone: 'America/New_York',
      };
      const result = parseTemporalExpression(input);

      expect(result.entitiesExtracted).toContain('prof');
      expect(result.entitiesExtracted).toContain('dave');
      expect(result.entitiesExtracted).toContain('fourier');
    });
  });
});

describe('tps/budget', () => {
  describe('isWithinBudget', () => {
    it('should return true for latency within budget', () => {
      expect(isWithinBudget(50)).toBe(true);
      expect(isWithinBudget(55)).toBe(true);
    });

    it('should return false for latency over budget', () => {
      expect(isWithinBudget(56)).toBe(false);
      expect(isWithinBudget(100)).toBe(false);
    });
  });
});

describe('tps/validation', () => {
  describe('validateTPSInput', () => {
    it('should validate correct input', () => {
      const input: TPSInput = {
        query: 'test query',
        referenceTimestamp: '2025-01-15T10:00:00Z',
        userTimezone: 'America/New_York',
      };
      expect(validateTPSInput(input)).toBe(true);
    });

    it('should reject invalid input', () => {
      expect(validateTPSInput({ query: '' })).toBe(false);
      expect(validateTPSInput(null)).toBe(false);
    });
  });

  describe('validateTPSOutput', () => {
    it('should validate correct output', () => {
      const output: TPSOutput = {
        temporalConstraint: null,
        entitiesExtracted: ['test'],
        parsingConfidence: 1.0,
      };
      expect(validateTPSOutput(output)).toBe(true);
    });
  });

  describe('validateTemporalConstraint', () => {
    it('should validate correct constraint', () => {
      const constraint: TemporalConstraint = {
        rangeStart: '2024-09-01T00:00:00Z',
        rangeEnd: '2024-09-30T23:59:59Z',
        rangeConfidence: 1.0,
        expressionType: 'explicit_absolute',
        originalExpression: 'September',
      };
      expect(validateTemporalConstraint(constraint)).toBe(true);
    });
  });
});
