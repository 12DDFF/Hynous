import { z } from 'zod';
import { T as TemporalGranularity } from '../constants-Blu2FVkv.js';

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

declare const EXPRESSION_TYPES: readonly ["explicit_absolute", "explicit_relative", "fuzzy_period", "duration", "none"];
type ExpressionType = (typeof EXPRESSION_TYPES)[number];
declare const TIME_SOURCES: readonly ["user_explicit", "calendar_sync", "file_timestamp", "content_extraction", "context_inference", "unknown"];
type TimeSource = (typeof TIME_SOURCES)[number];
/**
 * Source confidence values based on how time was obtained.
 */
declare const SOURCE_CONFIDENCE: Record<TimeSource, number>;
/**
 * Granularity confidence values based on precision level.
 */
declare const GRANULARITY_CONFIDENCE: Record<TemporalGranularity, number>;
/**
 * Expression type interpretation confidence.
 */
declare const INTERPRETATION_CONFIDENCE: Record<ExpressionType, number>;
/**
 * Three-factor temporal confidence scoring.
 */
interface ConfidenceFactors {
    /** How we got this time (0-1) */
    source: number;
    /** How precise the time is (0-1) */
    granularity: number;
    /** How sure about parsing (0-1) */
    interpretation: number;
}
declare const ConfidenceFactorsSchema: z.ZodObject<{
    source: z.ZodNumber;
    granularity: z.ZodNumber;
    interpretation: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    source: number;
    granularity: number;
    interpretation: number;
}, {
    source: number;
    granularity: number;
    interpretation: number;
}>;
/**
 * Calculates combined temporal confidence.
 * Formula: source × granularity × interpretation
 */
declare function computeConfidenceScore(factors: ConfidenceFactors): number;
/**
 * Gets source confidence for a time source.
 */
declare function getSourceConfidence(source: TimeSource): number;
/**
 * Gets granularity confidence for a precision level.
 */
declare function getGranularityConfidence(granularity: TemporalGranularity): number;
/**
 * Gets interpretation confidence for an expression type.
 */
declare function getInterpretationConfidence(type: ExpressionType): number;
/**
 * Input to the Temporal Parsing System.
 */
interface TPSInput {
    /** Full query text */
    query: string;
    /** When the query was made (ISO 8601) */
    referenceTimestamp: string;
    /** User's timezone (IANA format) */
    userTimezone: string;
}
declare const TPSInputSchema: z.ZodObject<{
    query: z.ZodString;
    referenceTimestamp: z.ZodString;
    userTimezone: z.ZodString;
}, "strip", z.ZodTypeAny, {
    query: string;
    referenceTimestamp: string;
    userTimezone: string;
}, {
    query: string;
    referenceTimestamp: string;
    userTimezone: string;
}>;
/**
 * Temporal constraint extracted from a query.
 */
interface TemporalConstraint {
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
declare const TemporalConstraintSchema: z.ZodObject<{
    rangeStart: z.ZodString;
    rangeEnd: z.ZodString;
    rangeConfidence: z.ZodNumber;
    expressionType: z.ZodEnum<["explicit_absolute", "explicit_relative", "fuzzy_period", "duration", "none"]>;
    originalExpression: z.ZodString;
}, "strip", z.ZodTypeAny, {
    rangeStart: string;
    rangeEnd: string;
    rangeConfidence: number;
    expressionType: "explicit_absolute" | "explicit_relative" | "fuzzy_period" | "duration" | "none";
    originalExpression: string;
}, {
    rangeStart: string;
    rangeEnd: string;
    rangeConfidence: number;
    expressionType: "explicit_absolute" | "explicit_relative" | "fuzzy_period" | "duration" | "none";
    originalExpression: string;
}>;
/**
 * Output from the Temporal Parsing System.
 */
interface TPSOutput {
    /** Parsed temporal constraint (null if no time in query) */
    temporalConstraint: TemporalConstraint | null;
    /** Non-temporal parts of the query */
    entitiesExtracted: string[];
    /** Overall parsing confidence (0-1) */
    parsingConfidence: number;
}
declare const TPSOutputSchema: z.ZodObject<{
    temporalConstraint: z.ZodNullable<z.ZodObject<{
        rangeStart: z.ZodString;
        rangeEnd: z.ZodString;
        rangeConfidence: z.ZodNumber;
        expressionType: z.ZodEnum<["explicit_absolute", "explicit_relative", "fuzzy_period", "duration", "none"]>;
        originalExpression: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        rangeStart: string;
        rangeEnd: string;
        rangeConfidence: number;
        expressionType: "explicit_absolute" | "explicit_relative" | "fuzzy_period" | "duration" | "none";
        originalExpression: string;
    }, {
        rangeStart: string;
        rangeEnd: string;
        rangeConfidence: number;
        expressionType: "explicit_absolute" | "explicit_relative" | "fuzzy_period" | "duration" | "none";
        originalExpression: string;
    }>>;
    entitiesExtracted: z.ZodArray<z.ZodString, "many">;
    parsingConfidence: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    temporalConstraint: {
        rangeStart: string;
        rangeEnd: string;
        rangeConfidence: number;
        expressionType: "explicit_absolute" | "explicit_relative" | "fuzzy_period" | "duration" | "none";
        originalExpression: string;
    } | null;
    entitiesExtracted: string[];
    parsingConfidence: number;
}, {
    temporalConstraint: {
        rangeStart: string;
        rangeEnd: string;
        rangeConfidence: number;
        expressionType: "explicit_absolute" | "explicit_relative" | "fuzzy_period" | "duration" | "none";
        originalExpression: string;
    } | null;
    entitiesExtracted: string[];
    parsingConfidence: number;
}>;
interface SeasonRange {
    startMonth: number;
    startDay: number;
    endMonth: number;
    endDay: number;
}
/**
 * Northern Hemisphere season definitions.
 */
declare const SEASONS: Record<string, SeasonRange>;
/**
 * Detects if a query contains a season reference.
 */
declare function detectSeason(query: string): string | null;
/**
 * Gets the date range for a season in a given year.
 */
declare function getSeasonRange(season: string, year: number): {
    start: Date;
    end: Date;
} | null;
/**
 * Parses relative time expressions.
 */
declare function parseRelativeTime(query: string, referenceDate: Date): {
    start: Date;
    end: Date;
    expression: string;
} | null;
/**
 * Parses absolute month references (e.g., "September", "in September 2024").
 */
declare function parseAbsoluteMonth(query: string, referenceDate: Date): {
    start: Date;
    end: Date;
    expression: string;
} | null;
/**
 * Parses fuzzy time expressions.
 */
declare function parseFuzzyTime(query: string, referenceDate: Date): {
    start: Date;
    end: Date;
    expression: string;
    confidence: number;
} | null;
/**
 * Main TPS parsing function.
 * Parses a query to extract temporal constraints.
 */
declare function parseTemporalExpression(input: TPSInput): TPSOutput;
declare const QUERY_STEP_BUDGETS: {
    readonly temporalParsing: 5;
    readonly entityExtraction: 3;
    readonly episodeFilter: 10;
    readonly semanticFilter: 30;
    readonly confidenceAggregate: 2;
    readonly resultAssembly: 3;
    readonly phase2Handoff: 2;
};
declare const PHASE_1_BUDGET_MS = 55;
/**
 * Checks if the total latency is within Phase 1 budget.
 */
declare function isWithinBudget(latencyMs: number): boolean;
/**
 * Validates TPS input.
 */
declare function validateTPSInput(input: unknown): input is TPSInput;
/**
 * Validates TPS output.
 */
declare function validateTPSOutput(output: unknown): output is TPSOutput;
/**
 * Validates a temporal constraint.
 */
declare function validateTemporalConstraint(constraint: unknown): constraint is TemporalConstraint;

export { type ConfidenceFactors, ConfidenceFactorsSchema, EXPRESSION_TYPES, type ExpressionType, GRANULARITY_CONFIDENCE, INTERPRETATION_CONFIDENCE, PHASE_1_BUDGET_MS, QUERY_STEP_BUDGETS, SEASONS, SOURCE_CONFIDENCE, type SeasonRange, TIME_SOURCES, type TPSInput, TPSInputSchema, type TPSOutput, TPSOutputSchema, type TemporalConstraint, TemporalConstraintSchema, TemporalGranularity, type TimeSource, computeConfidenceScore, detectSeason, getGranularityConfidence, getInterpretationConfidence, getSeasonRange, getSourceConfidence, isWithinBudget, parseAbsoluteMonth, parseFuzzyTime, parseRelativeTime, parseTemporalExpression, validateTPSInput, validateTPSOutput, validateTemporalConstraint };
