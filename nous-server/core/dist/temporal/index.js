import { z } from 'zod';

// src/temporal/index.ts

// src/constants.ts
var EVENT_TIME_SOURCES = ["explicit", "inferred", "user_stated"];
var CONTENT_TIME_TYPES = ["historical", "relative", "approximate"];

// src/temporal/index.ts
var IngestionTimeSchema = z.object({
  timestamp: z.string().datetime(),
  timezone: z.string()
});
var EventTimeSchema = z.object({
  timestamp: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  source: z.enum(EVENT_TIME_SOURCES)
});
var ContentTimeSchema = z.object({
  text: z.string(),
  resolved: z.string().datetime(),
  type: z.enum(CONTENT_TIME_TYPES),
  confidence: z.number().min(0).max(1)
});
var TemporalModelSchema = z.object({
  ingestion: IngestionTimeSchema,
  event: EventTimeSchema.optional(),
  content_times: z.array(ContentTimeSchema).optional(),
  reference_patterns: z.array(z.string()).optional()
});
var TemporalConfidenceSchema = z.object({
  source: z.number().min(0).max(1),
  granularity: z.number().min(0).max(1),
  interpretation: z.number().min(0).max(1),
  combined: z.number().min(0).max(1)
});
function createTemporalModel(timezone) {
  return {
    ingestion: {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      timezone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    }
  };
}
function addEventTime(temporal, eventTimestamp, source, confidence = 1) {
  return {
    ...temporal,
    event: {
      timestamp: typeof eventTimestamp === "string" ? eventTimestamp : eventTimestamp.toISOString(),
      source,
      confidence
    }
  };
}
function addContentTime(temporal, contentTime) {
  return {
    ...temporal,
    content_times: [...temporal.content_times ?? [], contentTime]
  };
}
function addReferencePattern(temporal, pattern) {
  const existing = temporal.reference_patterns ?? [];
  if (existing.includes(pattern)) {
    return temporal;
  }
  return {
    ...temporal,
    reference_patterns: [...existing, pattern]
  };
}
function calculateTemporalConfidence(source, granularity, interpretation) {
  return {
    source,
    granularity,
    interpretation,
    combined: source * granularity * interpretation
  };
}
function matchesTimeRange(temporal, start, end, queryType = "any") {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const inRange = (timestamp) => {
    const date = new Date(timestamp);
    return date >= startDate && date <= endDate;
  };
  if (queryType === "ingestion" || queryType === "any") {
    if (inRange(temporal.ingestion.timestamp)) {
      return true;
    }
  }
  if (queryType === "event" || queryType === "any") {
    if (temporal.event && inRange(temporal.event.timestamp)) {
      return true;
    }
  }
  if (queryType === "content" || queryType === "any") {
    if (temporal.content_times) {
      for (const ct of temporal.content_times) {
        if (inRange(ct.resolved)) {
          return true;
        }
      }
    }
  }
  return false;
}
function getPrimaryTimestamp(temporal) {
  return temporal.event?.timestamp ?? temporal.ingestion.timestamp;
}
function matchesReferencePattern(temporal, query) {
  if (!temporal.reference_patterns) {
    return false;
  }
  const queryLower = query.toLowerCase();
  return temporal.reference_patterns.some((pattern) => {
    const patternLower = pattern.toLowerCase();
    return queryLower.includes(patternLower) || patternLower.includes(queryLower);
  });
}

export { ContentTimeSchema, EventTimeSchema, IngestionTimeSchema, TemporalConfidenceSchema, TemporalModelSchema, addContentTime, addEventTime, addReferencePattern, calculateTemporalConfidence, createTemporalModel, getPrimaryTimestamp, matchesReferencePattern, matchesTimeRange };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map