import { z } from 'zod';
import { e as EventTimeSource, f as ContentTimeType } from '../constants-Blu2FVkv.js';
export { T as TemporalGranularity } from '../constants-Blu2FVkv.js';

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

/**
 * When the user added this content to Nous.
 * This is always known with certainty.
 */
interface IngestionTime {
    /** When content was added (ISO 8601) */
    timestamp: string;
    /** User's timezone when they added it */
    timezone: string;
}
declare const IngestionTimeSchema: z.ZodObject<{
    timestamp: z.ZodString;
    timezone: z.ZodString;
}, "strip", z.ZodTypeAny, {
    timestamp: string;
    timezone: string;
}, {
    timestamp: string;
    timezone: string;
}>;
/**
 * When the event actually happened (if different from ingestion).
 */
interface EventTime {
    /** When the event occurred (ISO 8601) */
    timestamp: string;
    /** Confidence in this timestamp (0-1) */
    confidence: number;
    /** How this time was determined */
    source: EventTimeSource;
}
declare const EventTimeSchema: z.ZodObject<{
    timestamp: z.ZodString;
    confidence: z.ZodNumber;
    source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
}, "strip", z.ZodTypeAny, {
    timestamp: string;
    confidence: number;
    source: "explicit" | "inferred" | "user_stated";
}, {
    timestamp: string;
    confidence: number;
    source: "explicit" | "inferred" | "user_stated";
}>;
/**
 * A time mentioned WITHIN the content itself.
 */
interface ContentTime {
    /** Original text mentioning time */
    text: string;
    /** Resolved timestamp (ISO 8601) */
    resolved: string;
    /** Type of time reference */
    type: ContentTimeType;
    /** Confidence in the resolution (0-1) */
    confidence: number;
}
declare const ContentTimeSchema: z.ZodObject<{
    text: z.ZodString;
    resolved: z.ZodString;
    type: z.ZodEnum<["historical", "relative", "approximate"]>;
    confidence: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "historical" | "relative" | "approximate";
    confidence: number;
    text: string;
    resolved: string;
}, {
    type: "historical" | "relative" | "approximate";
    confidence: number;
    text: string;
    resolved: string;
}>;
/**
 * Complete temporal model for a node.
 * Implements the four-type system from storm-011 v2.
 */
interface TemporalModel {
    /** When user added this to Nous. ALWAYS present. */
    ingestion: IngestionTime;
    /** When the event happened. Present for episodes and time-anchored content. */
    event?: EventTime;
    /** Times mentioned IN the content. Extracted during processing. */
    content_times?: ContentTime[];
    /** How user typically refers to this. Built from access patterns. */
    reference_patterns?: string[];
}
declare const TemporalModelSchema: z.ZodObject<{
    ingestion: z.ZodObject<{
        timestamp: z.ZodString;
        timezone: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        timestamp: string;
        timezone: string;
    }, {
        timestamp: string;
        timezone: string;
    }>;
    event: z.ZodOptional<z.ZodObject<{
        timestamp: z.ZodString;
        confidence: z.ZodNumber;
        source: z.ZodEnum<["explicit", "inferred", "user_stated"]>;
    }, "strip", z.ZodTypeAny, {
        timestamp: string;
        confidence: number;
        source: "explicit" | "inferred" | "user_stated";
    }, {
        timestamp: string;
        confidence: number;
        source: "explicit" | "inferred" | "user_stated";
    }>>;
    content_times: z.ZodOptional<z.ZodArray<z.ZodObject<{
        text: z.ZodString;
        resolved: z.ZodString;
        type: z.ZodEnum<["historical", "relative", "approximate"]>;
        confidence: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "historical" | "relative" | "approximate";
        confidence: number;
        text: string;
        resolved: string;
    }, {
        type: "historical" | "relative" | "approximate";
        confidence: number;
        text: string;
        resolved: string;
    }>, "many">>;
    reference_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    ingestion: {
        timestamp: string;
        timezone: string;
    };
    event?: {
        timestamp: string;
        confidence: number;
        source: "explicit" | "inferred" | "user_stated";
    } | undefined;
    content_times?: {
        type: "historical" | "relative" | "approximate";
        confidence: number;
        text: string;
        resolved: string;
    }[] | undefined;
    reference_patterns?: string[] | undefined;
}, {
    ingestion: {
        timestamp: string;
        timezone: string;
    };
    event?: {
        timestamp: string;
        confidence: number;
        source: "explicit" | "inferred" | "user_stated";
    } | undefined;
    content_times?: {
        type: "historical" | "relative" | "approximate";
        confidence: number;
        text: string;
        resolved: string;
    }[] | undefined;
    reference_patterns?: string[] | undefined;
}>;
/**
 * Three-factor temporal confidence from storm-004.
 */
interface TemporalConfidence {
    /** Confidence in time source */
    source: number;
    /** Confidence in granularity */
    granularity: number;
    /** Confidence in interpretation */
    interpretation: number;
    /** Combined score: source × granularity × interpretation */
    combined: number;
}
declare const TemporalConfidenceSchema: z.ZodObject<{
    source: z.ZodNumber;
    granularity: z.ZodNumber;
    interpretation: z.ZodNumber;
    combined: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    source: number;
    granularity: number;
    interpretation: number;
    combined: number;
}, {
    source: number;
    granularity: number;
    interpretation: number;
    combined: number;
}>;
/**
 * Creates a basic temporal model for new content.
 */
declare function createTemporalModel(timezone?: string): TemporalModel;
/**
 * Adds event time to a temporal model.
 */
declare function addEventTime(temporal: TemporalModel, eventTimestamp: string | Date, source: EventTimeSource, confidence?: number): TemporalModel;
/**
 * Adds a content time reference.
 */
declare function addContentTime(temporal: TemporalModel, contentTime: ContentTime): TemporalModel;
/**
 * Adds a reference pattern.
 */
declare function addReferencePattern(temporal: TemporalModel, pattern: string): TemporalModel;
/**
 * Calculates combined temporal confidence.
 */
declare function calculateTemporalConfidence(source: number, granularity: number, interpretation: number): TemporalConfidence;
type TimeQueryType = 'ingestion' | 'event' | 'content' | 'any';
/**
 * Checks if a temporal model matches a time range query.
 */
declare function matchesTimeRange(temporal: TemporalModel, start: string, end: string, queryType?: TimeQueryType): boolean;
/**
 * Gets the "primary" timestamp for a node.
 * Prefers event time if available, falls back to ingestion.
 */
declare function getPrimaryTimestamp(temporal: TemporalModel): string;
/**
 * Checks if reference patterns match a query.
 */
declare function matchesReferencePattern(temporal: TemporalModel, query: string): boolean;

export { type ContentTime, ContentTimeSchema, ContentTimeType, type EventTime, EventTimeSchema, EventTimeSource, type IngestionTime, IngestionTimeSchema, type TemporalConfidence, TemporalConfidenceSchema, type TemporalModel, TemporalModelSchema, type TimeQueryType, addContentTime, addEventTime, addReferencePattern, calculateTemporalConfidence, createTemporalModel, getPrimaryTimestamp, matchesReferencePattern, matchesTimeRange };
