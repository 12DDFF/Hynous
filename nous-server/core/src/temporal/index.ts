/**
 * @module @nous/core/temporal
 * @description Four-type temporal model for time handling
 * @version 0.1.0
 * @spec Brainstorms/Specs/storm-011/spec/temporal-model.ts
 *
 * Nous distinguishes FOUR types of time:
 * 1. Ingestion time - When user added content to Nous
 * 2. Event time - When the event actually happened
 * 3. Content times - Times mentioned IN the content
 * 4. Reference patterns - How user typically recalls it
 */

import { z } from 'zod';
import {
  EVENT_TIME_SOURCES,
  CONTENT_TIME_TYPES,
  type EventTimeSource,
  type ContentTimeType,
  type TemporalGranularity,
} from '../constants';

// ============================================================
// INGESTION TIME
// ============================================================

/**
 * When the user added this content to Nous.
 * This is always known with certainty.
 */
export interface IngestionTime {
  /** When content was added (ISO 8601) */
  timestamp: string;
  /** User's timezone when they added it */
  timezone: string;
}

export const IngestionTimeSchema = z.object({
  timestamp: z.string().datetime(),
  timezone: z.string(),
});

// ============================================================
// EVENT TIME
// ============================================================

/**
 * When the event actually happened (if different from ingestion).
 */
export interface EventTime {
  /** When the event occurred (ISO 8601) */
  timestamp: string;
  /** Confidence in this timestamp (0-1) */
  confidence: number;
  /** How this time was determined */
  source: EventTimeSource;
}

export const EventTimeSchema = z.object({
  timestamp: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  source: z.enum(EVENT_TIME_SOURCES),
});

// ============================================================
// CONTENT TIME
// ============================================================

/**
 * A time mentioned WITHIN the content itself.
 */
export interface ContentTime {
  /** Original text mentioning time */
  text: string;
  /** Resolved timestamp (ISO 8601) */
  resolved: string;
  /** Type of time reference */
  type: ContentTimeType;
  /** Confidence in the resolution (0-1) */
  confidence: number;
}

export const ContentTimeSchema = z.object({
  text: z.string(),
  resolved: z.string().datetime(),
  type: z.enum(CONTENT_TIME_TYPES),
  confidence: z.number().min(0).max(1),
});

// ============================================================
// TEMPORAL MODEL
// ============================================================

/**
 * Complete temporal model for a node.
 * Implements the four-type system from storm-011 v2.
 */
export interface TemporalModel {
  /** When user added this to Nous. ALWAYS present. */
  ingestion: IngestionTime;
  /** When the event happened. Present for episodes and time-anchored content. */
  event?: EventTime;
  /** Times mentioned IN the content. Extracted during processing. */
  content_times?: ContentTime[];
  /** How user typically refers to this. Built from access patterns. */
  reference_patterns?: string[];
}

export const TemporalModelSchema = z.object({
  ingestion: IngestionTimeSchema,
  event: EventTimeSchema.optional(),
  content_times: z.array(ContentTimeSchema).optional(),
  reference_patterns: z.array(z.string()).optional(),
});

// ============================================================
// TEMPORAL CONFIDENCE
// ============================================================

/**
 * Three-factor temporal confidence from storm-004.
 */
export interface TemporalConfidence {
  /** Confidence in time source */
  source: number;
  /** Confidence in granularity */
  granularity: number;
  /** Confidence in interpretation */
  interpretation: number;
  /** Combined score: source × granularity × interpretation */
  combined: number;
}

export const TemporalConfidenceSchema = z.object({
  source: z.number().min(0).max(1),
  granularity: z.number().min(0).max(1),
  interpretation: z.number().min(0).max(1),
  combined: z.number().min(0).max(1),
});

// ============================================================
// FACTORY FUNCTIONS
// ============================================================

/**
 * Creates a basic temporal model for new content.
 */
export function createTemporalModel(timezone?: string): TemporalModel {
  return {
    ingestion: {
      timestamp: new Date().toISOString(),
      timezone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}

/**
 * Adds event time to a temporal model.
 */
export function addEventTime(
  temporal: TemporalModel,
  eventTimestamp: string | Date,
  source: EventTimeSource,
  confidence: number = 1.0
): TemporalModel {
  return {
    ...temporal,
    event: {
      timestamp:
        typeof eventTimestamp === 'string'
          ? eventTimestamp
          : eventTimestamp.toISOString(),
      source,
      confidence,
    },
  };
}

/**
 * Adds a content time reference.
 */
export function addContentTime(
  temporal: TemporalModel,
  contentTime: ContentTime
): TemporalModel {
  return {
    ...temporal,
    content_times: [...(temporal.content_times ?? []), contentTime],
  };
}

/**
 * Adds a reference pattern.
 */
export function addReferencePattern(
  temporal: TemporalModel,
  pattern: string
): TemporalModel {
  const existing = temporal.reference_patterns ?? [];
  if (existing.includes(pattern)) {
    return temporal;
  }
  return {
    ...temporal,
    reference_patterns: [...existing, pattern],
  };
}

/**
 * Calculates combined temporal confidence.
 */
export function calculateTemporalConfidence(
  source: number,
  granularity: number,
  interpretation: number
): TemporalConfidence {
  return {
    source,
    granularity,
    interpretation,
    combined: source * granularity * interpretation,
  };
}

// ============================================================
// QUERY HELPERS
// ============================================================

export type TimeQueryType = 'ingestion' | 'event' | 'content' | 'any';

/**
 * Checks if a temporal model matches a time range query.
 */
export function matchesTimeRange(
  temporal: TemporalModel,
  start: string,
  end: string,
  queryType: TimeQueryType = 'any'
): boolean {
  const startDate = new Date(start);
  const endDate = new Date(end);

  const inRange = (timestamp: string): boolean => {
    const date = new Date(timestamp);
    return date >= startDate && date <= endDate;
  };

  // Check ingestion time
  if (queryType === 'ingestion' || queryType === 'any') {
    if (inRange(temporal.ingestion.timestamp)) {
      return true;
    }
  }

  // Check event time
  if (queryType === 'event' || queryType === 'any') {
    if (temporal.event && inRange(temporal.event.timestamp)) {
      return true;
    }
  }

  // Check content times
  if (queryType === 'content' || queryType === 'any') {
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

/**
 * Gets the "primary" timestamp for a node.
 * Prefers event time if available, falls back to ingestion.
 */
export function getPrimaryTimestamp(temporal: TemporalModel): string {
  return temporal.event?.timestamp ?? temporal.ingestion.timestamp;
}

/**
 * Checks if reference patterns match a query.
 */
export function matchesReferencePattern(
  temporal: TemporalModel,
  query: string
): boolean {
  if (!temporal.reference_patterns) {
    return false;
  }

  const queryLower = query.toLowerCase();
  return temporal.reference_patterns.some((pattern) => {
    const patternLower = pattern.toLowerCase();
    return queryLower.includes(patternLower) || patternLower.includes(queryLower);
  });
}

// ============================================================
// RE-EXPORTS
// ============================================================

export type { EventTimeSource, ContentTimeType, TemporalGranularity };
