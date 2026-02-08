import { z } from 'zod';

// src/tps/index.ts
var EXPRESSION_TYPES = [
  "explicit_absolute",
  "explicit_relative",
  "fuzzy_period",
  "duration",
  "none"
];
var TIME_SOURCES = [
  "user_explicit",
  "calendar_sync",
  "file_timestamp",
  "content_extraction",
  "context_inference",
  "unknown"
];
var SOURCE_CONFIDENCE = {
  user_explicit: 1,
  calendar_sync: 0.95,
  file_timestamp: 0.9,
  content_extraction: 0.7,
  context_inference: 0.5,
  unknown: 0.3
};
var GRANULARITY_CONFIDENCE = {
  minute: 1,
  hour: 0.9,
  day: 0.8,
  week: 0.6,
  month: 0.4,
  year: 0.2
};
var INTERPRETATION_CONFIDENCE = {
  explicit_absolute: 1,
  explicit_relative: 0.95,
  fuzzy_period: 0.6,
  duration: 0.8,
  none: 1
};
var ConfidenceFactorsSchema = z.object({
  source: z.number().min(0).max(1),
  granularity: z.number().min(0).max(1),
  interpretation: z.number().min(0).max(1)
});
function computeConfidenceScore(factors) {
  return factors.source * factors.granularity * factors.interpretation;
}
function getSourceConfidence(source) {
  return SOURCE_CONFIDENCE[source];
}
function getGranularityConfidence(granularity) {
  return GRANULARITY_CONFIDENCE[granularity];
}
function getInterpretationConfidence(type) {
  return INTERPRETATION_CONFIDENCE[type];
}
var TPSInputSchema = z.object({
  query: z.string().min(1),
  referenceTimestamp: z.string().datetime(),
  userTimezone: z.string().min(1)
});
var TemporalConstraintSchema = z.object({
  rangeStart: z.string().datetime(),
  rangeEnd: z.string().datetime(),
  rangeConfidence: z.number().min(0).max(1),
  expressionType: z.enum(EXPRESSION_TYPES),
  originalExpression: z.string()
});
var TPSOutputSchema = z.object({
  temporalConstraint: TemporalConstraintSchema.nullable(),
  entitiesExtracted: z.array(z.string()),
  parsingConfidence: z.number().min(0).max(1)
});
var SEASONS = {
  spring: { startMonth: 3, startDay: 1, endMonth: 5, endDay: 31 },
  summer: { startMonth: 6, startDay: 1, endMonth: 8, endDay: 31 },
  fall: { startMonth: 9, startDay: 1, endMonth: 11, endDay: 30 },
  autumn: { startMonth: 9, startDay: 1, endMonth: 11, endDay: 30 },
  winter: { startMonth: 12, startDay: 1, endMonth: 2, endDay: 28 }
};
function detectSeason(query) {
  const lowerQuery = query.toLowerCase();
  for (const season of Object.keys(SEASONS)) {
    if (lowerQuery.includes(season)) {
      return season;
    }
  }
  return null;
}
function getSeasonRange(season, year) {
  const range = SEASONS[season.toLowerCase()];
  if (!range) {
    return null;
  }
  if (season.toLowerCase() === "winter") {
    return {
      start: new Date(Date.UTC(year, range.startMonth - 1, range.startDay)),
      end: new Date(Date.UTC(year + 1, range.endMonth - 1, range.endDay))
    };
  }
  return {
    start: new Date(Date.UTC(year, range.startMonth - 1, range.startDay)),
    end: new Date(Date.UTC(year, range.endMonth - 1, range.endDay))
  };
}
var RELATIVE_PATTERNS = [
  {
    pattern: /yesterday/i,
    calculate: (_, ref) => {
      const start = new Date(ref);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  },
  {
    pattern: /today/i,
    calculate: (_, ref) => {
      const start = new Date(ref);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
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
    }
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
    }
  },
  {
    pattern: /(\d+)\s+days?\s+ago/i,
    calculate: (match, ref) => {
      const days = parseInt(match[1] ?? "1", 10);
      const start = new Date(ref);
      start.setDate(start.getDate() - days);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  },
  {
    pattern: /(\d+)\s+weeks?\s+ago/i,
    calculate: (match, ref) => {
      const weeks = parseInt(match[1] ?? "1", 10);
      const end = new Date(ref);
      end.setDate(end.getDate() - weeks * 7);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  },
  {
    pattern: /(\d+)\s+months?\s+ago/i,
    calculate: (match, ref) => {
      const months = parseInt(match[1] ?? "1", 10);
      const start = new Date(ref);
      start.setMonth(start.getMonth() - months, 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  }
];
var MONTHS = {
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
  dec: 11
};
function parseRelativeTime(query, referenceDate) {
  for (const { pattern, calculate } of RELATIVE_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      const { start, end } = calculate(match, referenceDate);
      return { start, end, expression: match[0] };
    }
  }
  return null;
}
function parseAbsoluteMonth(query, referenceDate) {
  const monthPattern = /(?:in\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?/i;
  const match = query.match(monthPattern);
  if (match && match[1]) {
    const monthName = match[1].toLowerCase();
    const month = MONTHS[monthName];
    if (month === void 0) {
      return null;
    }
    const year = match[2] ? parseInt(match[2], 10) : void 0;
    let targetYear = year ?? referenceDate.getFullYear();
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
function parseFuzzyTime(query, referenceDate) {
  const lowerQuery = query.toLowerCase();
  if (lowerQuery.includes("recently")) {
    const end = new Date(referenceDate);
    const start = new Date(referenceDate);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end, expression: "recently", confidence: 0.7 };
  }
  if (lowerQuery.includes("a while back") || lowerQuery.includes("a while ago")) {
    const end = new Date(referenceDate);
    end.setMonth(end.getMonth() - 1);
    const start = new Date(referenceDate);
    start.setMonth(start.getMonth() - 6);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end, expression: "a while back", confidence: 0.4 };
  }
  if (lowerQuery.includes("a few months ago")) {
    const end = new Date(referenceDate);
    end.setMonth(end.getMonth() - 2);
    const start = new Date(referenceDate);
    start.setMonth(start.getMonth() - 4);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end, expression: "a few months ago", confidence: 0.5 };
  }
  const season = detectSeason(query);
  if (season) {
    let targetYear = referenceDate.getFullYear();
    const range = getSeasonRange(season, targetYear);
    if (range) {
      if (range.end > referenceDate) {
        const lastYearRange = getSeasonRange(season, targetYear - 1);
        if (lastYearRange) {
          return {
            start: lastYearRange.start,
            end: lastYearRange.end,
            expression: season,
            confidence: 0.6
          };
        }
      }
      return { start: range.start, end: range.end, expression: season, confidence: 0.6 };
    }
  }
  return null;
}
function parseTemporalExpression(input) {
  const referenceDate = new Date(input.referenceTimestamp);
  const query = input.query;
  const relative = parseRelativeTime(query, referenceDate);
  if (relative) {
    return {
      temporalConstraint: {
        rangeStart: relative.start.toISOString(),
        rangeEnd: relative.end.toISOString(),
        rangeConfidence: 0.95,
        expressionType: "explicit_relative",
        originalExpression: relative.expression
      },
      entitiesExtracted: extractNonTemporalEntities(query, relative.expression),
      parsingConfidence: 0.95
    };
  }
  const absolute = parseAbsoluteMonth(query, referenceDate);
  if (absolute) {
    return {
      temporalConstraint: {
        rangeStart: absolute.start.toISOString(),
        rangeEnd: absolute.end.toISOString(),
        rangeConfidence: 1,
        expressionType: "explicit_absolute",
        originalExpression: absolute.expression
      },
      entitiesExtracted: extractNonTemporalEntities(query, absolute.expression),
      parsingConfidence: 1
    };
  }
  const fuzzy = parseFuzzyTime(query, referenceDate);
  if (fuzzy) {
    return {
      temporalConstraint: {
        rangeStart: fuzzy.start.toISOString(),
        rangeEnd: fuzzy.end.toISOString(),
        rangeConfidence: fuzzy.confidence,
        expressionType: "fuzzy_period",
        originalExpression: fuzzy.expression
      },
      entitiesExtracted: extractNonTemporalEntities(query, fuzzy.expression),
      parsingConfidence: fuzzy.confidence
    };
  }
  return {
    temporalConstraint: null,
    entitiesExtracted: extractNonTemporalEntities(query, ""),
    parsingConfidence: 1
  };
}
function extractNonTemporalEntities(query, temporalPart) {
  let remaining = query.replace(temporalPart, "").trim();
  const stopWords = [
    "what",
    "when",
    "where",
    "who",
    "how",
    "did",
    "do",
    "does",
    "the",
    "a",
    "an",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "about",
    "i",
    "me",
    "my",
    "we",
    "our",
    "learn",
    "learned",
    "teach",
    "taught"
  ];
  const words = remaining.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter((word) => word.length > 2 && !stopWords.includes(word));
  return [...new Set(words)];
}
var QUERY_STEP_BUDGETS = {
  temporalParsing: 5,
  entityExtraction: 3,
  episodeFilter: 10,
  semanticFilter: 30,
  confidenceAggregate: 2,
  resultAssembly: 3,
  phase2Handoff: 2
};
var PHASE_1_BUDGET_MS = 55;
function isWithinBudget(latencyMs) {
  return latencyMs <= PHASE_1_BUDGET_MS;
}
function validateTPSInput(input) {
  return TPSInputSchema.safeParse(input).success;
}
function validateTPSOutput(output) {
  return TPSOutputSchema.safeParse(output).success;
}
function validateTemporalConstraint(constraint) {
  return TemporalConstraintSchema.safeParse(constraint).success;
}

export { ConfidenceFactorsSchema, EXPRESSION_TYPES, GRANULARITY_CONFIDENCE, INTERPRETATION_CONFIDENCE, PHASE_1_BUDGET_MS, QUERY_STEP_BUDGETS, SEASONS, SOURCE_CONFIDENCE, TIME_SOURCES, TPSInputSchema, TPSOutputSchema, TemporalConstraintSchema, computeConfidenceScore, detectSeason, getGranularityConfidence, getInterpretationConfidence, getSeasonRange, getSourceConfidence, isWithinBudget, parseAbsoluteMonth, parseFuzzyTime, parseRelativeTime, parseTemporalExpression, validateTPSInput, validateTPSOutput, validateTemporalConstraint };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map