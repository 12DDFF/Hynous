/**
 * @module @nous/core/tps
 * @description Temporal Parsing System (TPS) for natural language time queries
 * @version 0.1.0
 * @spec Brainstorms/Specs/storm-004/spec/temporal-parsing.ts
 *
 * Converts natural language time expressions into precise, searchable
 * constraints with confidence scores.
 *
 * Expression types:
 * - explicit_absolute: "January 15, 2024"
 * - explicit_relative: "last week", "3 days ago"
 * - fuzzy_period: "around summer", "a while back"
 * - duration: "during the meeting"
 * - none: No temporal expression found
 */

import { z } from 'zod';
import { type TemporalGranularity } from '../constants';

// ============================================================
// EXPRESSION TYPES
// ============================================================

export const EXPRESSION_TYPES = [
  'explicit_absolute',
  'explicit_relative',
  'fuzzy_period',
  'duration',
  'none',
] as const;

export type ExpressionType = (typeof EXPRESSION_TYPES)[number];

// ============================================================
// TIME SOURCES
// ============================================================

export const TIME_SOURCES = [
  'user_explicit',
  'calendar_sync',
  'file_timestamp',
  'content_extraction',
  'context_inference',
  'unknown',
] as const;

export type TimeSource = (typeof TIME_SOURCES)[number];

// ============================================================
// CONFIDENCE VALUES
// ============================================================

/**
 * Source confidence values based on how time was obtained.
 */
export const SOURCE_CONFIDENCE: Record<TimeSource, number> = {
  user_explicit: 1.0,
  calendar_sync: 0.95,
  file_timestamp: 0.9,
  content_extraction: 0.7,
  context_inference: 0.5,
  unknown: 0.3,
};

/**
 * Granularity confidence values based on precision level.
 */
export const GRANULARITY_CONFIDENCE: Record<TemporalGranularity, number> = {
  minute: 1.0,
  hour: 0.9,
  day: 0.8,
  week: 0.6,
  month: 0.4,
  year: 0.2,
};

/**
 * Expression type interpretation confidence.
 */
export const INTERPRETATION_CONFIDENCE: Record<ExpressionType, number> = {
  explicit_absolute: 1.0,
  explicit_relative: 0.95,
  fuzzy_period: 0.6,
  duration: 0.8,
  none: 1.0,
};

// ============================================================
// CONFIDENCE FACTORS
// ============================================================

/**
 * Three-factor temporal confidence scoring.
 */
export interface ConfidenceFactors {
  /** How we got this time (0-1) */
  source: number;
  /** How precise the time is (0-1) */
  granularity: number;
  /** How sure about parsing (0-1) */
  interpretation: number;
}

export const ConfidenceFactorsSchema = z.object({
  source: z.number().min(0).max(1),
  granularity: z.number().min(0).max(1),
  interpretation: z.number().min(0).max(1),
});

/**
 * Calculates combined temporal confidence.
 * Formula: source × granularity × interpretation
 */
export function computeConfidenceScore(factors: ConfidenceFactors): number {
  return factors.source * factors.granularity * factors.interpretation;
}

/**
 * Gets source confidence for a time source.
 */
export function getSourceConfidence(source: TimeSource): number {
  return SOURCE_CONFIDENCE[source];
}

/**
 * Gets granularity confidence for a precision level.
 */
export function getGranularityConfidence(granularity: TemporalGranularity): number {
  return GRANULARITY_CONFIDENCE[granularity];
}

/**
 * Gets interpretation confidence for an expression type.
 */
export function getInterpretationConfidence(type: ExpressionType): number {
  return INTERPRETATION_CONFIDENCE[type];
}

// ============================================================
// TPS INPUT / OUTPUT
// ============================================================

/**
 * Input to the Temporal Parsing System.
 */
export interface TPSInput {
  /** Full query text */
  query: string;
  /** When the query was made (ISO 8601) */
  referenceTimestamp: string;
  /** User's timezone (IANA format) */
  userTimezone: string;
}

export const TPSInputSchema = z.object({
  query: z.string().min(1),
  referenceTimestamp: z.string().datetime(),
  userTimezone: z.string().min(1),
});

/**
 * Temporal constraint extracted from a query.
 */
export interface TemporalConstraint {
  /** Start of search range (ISO 8601 UTC) */
  rangeStart: string;
  /** End of search range (ISO 8601 UTC) */
  rangeEnd: string;
  /** Confidence in this range (0-1) */
  rangeConfidence: number;
  /** Type of expression parsed */
  expressionType: ExpressionType;
  /** Original text that was parsed */
  originalExpression: string;
}

export const TemporalConstraintSchema = z.object({
  rangeStart: z.string().datetime(),
  rangeEnd: z.string().datetime(),
  rangeConfidence: z.number().min(0).max(1),
  expressionType: z.enum(EXPRESSION_TYPES),
  originalExpression: z.string(),
});

/**
 * Output from the Temporal Parsing System.
 */
export interface TPSOutput {
  /** Parsed temporal constraint (null if no time in query) */
  temporalConstraint: TemporalConstraint | null;
  /** Non-temporal parts of the query */
  entitiesExtracted: string[];
  /** Overall parsing confidence (0-1) */
  parsingConfidence: number;
}

export const TPSOutputSchema = z.object({
  temporalConstraint: TemporalConstraintSchema.nullable(),
  entitiesExtracted: z.array(z.string()),
  parsingConfidence: z.number().min(0).max(1),
});

// ============================================================
// SEASONS
// ============================================================

export interface SeasonRange {
  startMonth: number; // 1-12
  startDay: number;
  endMonth: number;
  endDay: number;
}

/**
 * Northern Hemisphere season definitions.
 */
export const SEASONS: Record<string, SeasonRange> = {
  spring: { startMonth: 3, startDay: 1, endMonth: 5, endDay: 31 },
  summer: { startMonth: 6, startDay: 1, endMonth: 8, endDay: 31 },
  fall: { startMonth: 9, startDay: 1, endMonth: 11, endDay: 30 },
  autumn: { startMonth: 9, startDay: 1, endMonth: 11, endDay: 30 },
  winter: { startMonth: 12, startDay: 1, endMonth: 2, endDay: 28 },
};

/**
 * Detects if a query contains a season reference.
 */
export function detectSeason(query: string): string | null {
  const lowerQuery = query.toLowerCase();
  for (const season of Object.keys(SEASONS)) {
    if (lowerQuery.includes(season)) {
      return season;
    }
  }
  return null;
}

/**
 * Gets the date range for a season in a given year.
 */
export function getSeasonRange(
  season: string,
  year: number
): { start: Date; end: Date } | null {
  const range = SEASONS[season.toLowerCase()];
  if (!range) {
    return null;
  }

  // Handle winter which spans years
  if (season.toLowerCase() === 'winter') {
    return {
      start: new Date(Date.UTC(year, range.startMonth - 1, range.startDay)),
      end: new Date(Date.UTC(year + 1, range.endMonth - 1, range.endDay)),
    };
  }

  return {
    start: new Date(Date.UTC(year, range.startMonth - 1, range.startDay)),
    end: new Date(Date.UTC(year, range.endMonth - 1, range.endDay)),
  };
}

// ============================================================
// TEMPORAL PARSING
// ============================================================

/**
 * Relative time patterns with their calculations.
 */
const RELATIVE_PATTERNS: {
  pattern: RegExp;
  calculate: (match: RegExpMatchArray, ref: Date) => { start: Date; end: Date };
}[] = [
  {
    pattern: /yesterday/i,
    calculate: (_, ref) => {
      const start = new Date(ref);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    },
  },
  {
    pattern: /today/i,
    calculate: (_, ref) => {
      const start = new Date(ref);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    },
  },
  {
    pattern: /last\s+week/i,
    calculate: (_, ref) => {
      const end = new Date(ref);
      end.setDate(end.getDate() - 1);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    },
  },
  {
    pattern: /last\s+month/i,
    calculate: (_, ref) => {
      const start = new Date(ref);
      start.setMonth(start.getMonth() - 1, 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    },
  },
  {
    pattern: /(\d+)\s+days?\s+ago/i,
    calculate: (match, ref) => {
      const days = parseInt(match[1] ?? '1', 10);
      const start = new Date(ref);
      start.setDate(start.getDate() - days);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    },
  },
  {
    pattern: /(\d+)\s+weeks?\s+ago/i,
    calculate: (match, ref) => {
      const weeks = parseInt(match[1] ?? '1', 10);
      const end = new Date(ref);
      end.setDate(end.getDate() - weeks * 7);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    },
  },
  {
    pattern: /(\d+)\s+months?\s+ago/i,
    calculate: (match, ref) => {
      const months = parseInt(match[1] ?? '1', 10);
      const start = new Date(ref);
      start.setMonth(start.getMonth() - months, 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    },
  },
];

/**
 * Month names for parsing.
 */
const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Parses relative time expressions.
 */
export function parseRelativeTime(
  query: string,
  referenceDate: Date
): { start: Date; end: Date; expression: string } | null {
  for (const { pattern, calculate } of RELATIVE_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      const { start, end } = calculate(match, referenceDate);
      return { start, end, expression: match[0] };
    }
  }
  return null;
}

/**
 * Parses absolute month references (e.g., "September", "in September 2024").
 */
export function parseAbsoluteMonth(
  query: string,
  referenceDate: Date
): { start: Date; end: Date; expression: string } | null {
  // Match "in [Month]" or just "[Month]" with optional year
  const monthPattern =
    /(?:in\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?/i;
  const match = query.match(monthPattern);

  if (match && match[1]) {
    const monthName = match[1].toLowerCase();
    const month = MONTHS[monthName];

    // If month is not recognized, return null
    if (month === undefined) {
      return null;
    }

    const year = match[2] ? parseInt(match[2], 10) : undefined;

    let targetYear = year ?? referenceDate.getFullYear();

    // If no year specified and the month is in the future, use last year
    if (!year) {
      const refMonth = referenceDate.getMonth();
      if (month > refMonth) {
        targetYear -= 1;
      }
    }

    const start = new Date(Date.UTC(targetYear, month, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(targetYear, month + 1, 0, 23, 59, 59, 999));

    return { start, end, expression: match[0] };
  }

  return null;
}

/**
 * Parses fuzzy time expressions.
 */
export function parseFuzzyTime(
  query: string,
  referenceDate: Date
): { start: Date; end: Date; expression: string; confidence: number } | null {
  const lowerQuery = query.toLowerCase();

  // "recently" - last 7 days
  if (lowerQuery.includes('recently')) {
    const end = new Date(referenceDate);
    const start = new Date(referenceDate);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end, expression: 'recently', confidence: 0.7 };
  }

  // "a while back" - 1-6 months ago
  if (lowerQuery.includes('a while back') || lowerQuery.includes('a while ago')) {
    const end = new Date(referenceDate);
    end.setMonth(end.getMonth() - 1);
    const start = new Date(referenceDate);
    start.setMonth(start.getMonth() - 6);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end, expression: 'a while back', confidence: 0.4 };
  }

  // "a few months ago" - 2-4 months ago
  if (lowerQuery.includes('a few months ago')) {
    const end = new Date(referenceDate);
    end.setMonth(end.getMonth() - 2);
    const start = new Date(referenceDate);
    start.setMonth(start.getMonth() - 4);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end, expression: 'a few months ago', confidence: 0.5 };
  }

  // Season detection
  const season = detectSeason(query);
  if (season) {
    let targetYear = referenceDate.getFullYear();
    const range = getSeasonRange(season, targetYear);

    if (range) {
      // If the season end is in the future, use last year
      if (range.end > referenceDate) {
        const lastYearRange = getSeasonRange(season, targetYear - 1);
        if (lastYearRange) {
          return {
            start: lastYearRange.start,
            end: lastYearRange.end,
            expression: season,
            confidence: 0.6,
          };
        }
      }
      return { start: range.start, end: range.end, expression: season, confidence: 0.6 };
    }
  }

  return null;
}

/**
 * Main TPS parsing function.
 * Parses a query to extract temporal constraints.
 */
export function parseTemporalExpression(input: TPSInput): TPSOutput {
  const referenceDate = new Date(input.referenceTimestamp);
  const query = input.query;

  // Try relative time first
  const relative = parseRelativeTime(query, referenceDate);
  if (relative) {
    return {
      temporalConstraint: {
        rangeStart: relative.start.toISOString(),
        rangeEnd: relative.end.toISOString(),
        rangeConfidence: 0.95,
        expressionType: 'explicit_relative',
        originalExpression: relative.expression,
      },
      entitiesExtracted: extractNonTemporalEntities(query, relative.expression),
      parsingConfidence: 0.95,
    };
  }

  // Try absolute month
  const absolute = parseAbsoluteMonth(query, referenceDate);
  if (absolute) {
    return {
      temporalConstraint: {
        rangeStart: absolute.start.toISOString(),
        rangeEnd: absolute.end.toISOString(),
        rangeConfidence: 1.0,
        expressionType: 'explicit_absolute',
        originalExpression: absolute.expression,
      },
      entitiesExtracted: extractNonTemporalEntities(query, absolute.expression),
      parsingConfidence: 1.0,
    };
  }

  // Try fuzzy time
  const fuzzy = parseFuzzyTime(query, referenceDate);
  if (fuzzy) {
    return {
      temporalConstraint: {
        rangeStart: fuzzy.start.toISOString(),
        rangeEnd: fuzzy.end.toISOString(),
        rangeConfidence: fuzzy.confidence,
        expressionType: 'fuzzy_period',
        originalExpression: fuzzy.expression,
      },
      entitiesExtracted: extractNonTemporalEntities(query, fuzzy.expression),
      parsingConfidence: fuzzy.confidence,
    };
  }

  // No temporal expression found
  return {
    temporalConstraint: null,
    entitiesExtracted: extractNonTemporalEntities(query, ''),
    parsingConfidence: 1.0,
  };
}

/**
 * Extracts non-temporal entities from a query.
 * Simple word extraction - more sophisticated NER would be added later.
 */
function extractNonTemporalEntities(query: string, temporalPart: string): string[] {
  // Remove the temporal part
  let remaining = query.replace(temporalPart, '').trim();

  // Remove common query words
  const stopWords = [
    'what',
    'when',
    'where',
    'who',
    'how',
    'did',
    'do',
    'does',
    'the',
    'a',
    'an',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
    'about',
    'i',
    'me',
    'my',
    'we',
    'our',
    'learn',
    'learned',
    'teach',
    'taught',
  ];

  const words = remaining
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.includes(word));

  // Remove duplicates
  return [...new Set(words)];
}

// ============================================================
// QUERY STEP BUDGETS (from spec)
// ============================================================

export const QUERY_STEP_BUDGETS = {
  temporalParsing: 5,
  entityExtraction: 3,
  episodeFilter: 10,
  semanticFilter: 30,
  confidenceAggregate: 2,
  resultAssembly: 3,
  phase2Handoff: 2,
} as const;

export const PHASE_1_BUDGET_MS = 55;

/**
 * Checks if the total latency is within Phase 1 budget.
 */
export function isWithinBudget(latencyMs: number): boolean {
  return latencyMs <= PHASE_1_BUDGET_MS;
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validates TPS input.
 */
export function validateTPSInput(input: unknown): input is TPSInput {
  return TPSInputSchema.safeParse(input).success;
}

/**
 * Validates TPS output.
 */
export function validateTPSOutput(output: unknown): output is TPSOutput {
  return TPSOutputSchema.safeParse(output).success;
}

/**
 * Validates a temporal constraint.
 */
export function validateTemporalConstraint(
  constraint: unknown
): constraint is TemporalConstraint {
  return TemporalConstraintSchema.safeParse(constraint).success;
}

// ============================================================
// RE-EXPORTS
// ============================================================

export type { TemporalGranularity };
