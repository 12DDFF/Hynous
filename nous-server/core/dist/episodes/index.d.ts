import { z } from 'zod';
import { T as TemporalGranularity, c as EpisodeSubtype } from '../constants-Blu2FVkv.js';
import { TimeSource, ConfidenceFactors } from '../tps/index.js';
export { TIME_SOURCES } from '../tps/index.js';

/**
 * @module @nous/core/episodes
 * @description Episode utilities with enhanced TPS metadata
 * @version 0.1.0
 * @spec Brainstorms/Specs/storm-004/spec/episode-schema.ts
 *
 * Episodes are time-indexed event containers that link
 * semantic concepts to temporal contexts.
 */

/** Prefix for episode IDs */
declare const EPISODE_ID_PREFIX = "ep_";
/**
 * Generates a globally unique episode ID.
 * Format: "ep_" + nanoid(12)
 */
declare function generateEpisodeId(): string;
declare const EPISODE_TYPES: readonly ["lecture", "meeting", "conversation", "note_session", "document_read", "thought", "external_event"];
type EpisodeType = EpisodeSubtype;
/**
 * Enhanced temporal metadata for episodes.
 * Includes three-factor confidence scoring.
 */
interface EpisodeTemporalMetadata {
    /** Primary timestamp in UTC (ISO 8601) */
    timestampUtc: string;
    /** Original timezone where event occurred (IANA format) */
    timezoneOriginal: string;
    /** Precision level of the timestamp */
    granularity: TemporalGranularity;
    /** Three-factor confidence scoring */
    confidence: ConfidenceFactors;
    /** Duration in minutes (for duration-based episodes) */
    durationMinutes?: number;
    /** End timestamp for duration-based episodes */
    endTimestampUtc?: string;
}
declare const EpisodeTemporalMetadataSchema: z.ZodObject<{
    timestampUtc: z.ZodString;
    timezoneOriginal: z.ZodString;
    granularity: z.ZodEnum<["minute", "hour", "day", "week", "month", "year"]>;
    confidence: z.ZodObject<{
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
    durationMinutes: z.ZodOptional<z.ZodNumber>;
    endTimestampUtc: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    confidence: {
        source: number;
        granularity: number;
        interpretation: number;
    };
    granularity: "minute" | "hour" | "day" | "week" | "month" | "year";
    timestampUtc: string;
    timezoneOriginal: string;
    durationMinutes?: number | undefined;
    endTimestampUtc?: string | undefined;
}, {
    confidence: {
        source: number;
        granularity: number;
        interpretation: number;
    };
    granularity: "minute" | "hour" | "day" | "week" | "month" | "year";
    timestampUtc: string;
    timezoneOriginal: string;
    durationMinutes?: number | undefined;
    endTimestampUtc?: string | undefined;
}>;
/**
 * An episode is a time-indexed event container.
 *
 * Episodes link:
 * - Temporal context (when it happened)
 * - Semantic concepts (what was learned/discussed)
 * - Archive sources (full content if needed)
 */
interface Episode {
    /** Globally unique episode ID */
    id: string;
    /** Type of episode */
    type: EpisodeType;
    /** Brief summary of the episode */
    summary: string;
    /** IDs of concepts extracted from this episode */
    conceptLinks: string[];
    /** ID of archive node with full content (if any) */
    archiveLink: string | null;
    /** Enhanced temporal metadata */
    temporal: EpisodeTemporalMetadata;
    /** When this episode record was created */
    createdAt: string;
    /** When this episode record was last updated */
    updatedAt: string;
}
declare const EpisodeSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodUnion<[z.ZodEnum<["lecture", "meeting", "conversation", "note_session", "document_read", "thought", "external_event"]>, z.ZodString]>;
    summary: z.ZodString;
    conceptLinks: z.ZodArray<z.ZodString, "many">;
    archiveLink: z.ZodNullable<z.ZodString>;
    temporal: z.ZodObject<{
        timestampUtc: z.ZodString;
        timezoneOriginal: z.ZodString;
        granularity: z.ZodEnum<["minute", "hour", "day", "week", "month", "year"]>;
        confidence: z.ZodObject<{
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
        durationMinutes: z.ZodOptional<z.ZodNumber>;
        endTimestampUtc: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        confidence: {
            source: number;
            granularity: number;
            interpretation: number;
        };
        granularity: "minute" | "hour" | "day" | "week" | "month" | "year";
        timestampUtc: string;
        timezoneOriginal: string;
        durationMinutes?: number | undefined;
        endTimestampUtc?: string | undefined;
    }, {
        confidence: {
            source: number;
            granularity: number;
            interpretation: number;
        };
        granularity: "minute" | "hour" | "day" | "week" | "month" | "year";
        timestampUtc: string;
        timezoneOriginal: string;
        durationMinutes?: number | undefined;
        endTimestampUtc?: string | undefined;
    }>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: string;
    id: string;
    summary: string;
    temporal: {
        confidence: {
            source: number;
            granularity: number;
            interpretation: number;
        };
        granularity: "minute" | "hour" | "day" | "week" | "month" | "year";
        timestampUtc: string;
        timezoneOriginal: string;
        durationMinutes?: number | undefined;
        endTimestampUtc?: string | undefined;
    };
    conceptLinks: string[];
    archiveLink: string | null;
    createdAt: string;
    updatedAt: string;
}, {
    type: string;
    id: string;
    summary: string;
    temporal: {
        confidence: {
            source: number;
            granularity: number;
            interpretation: number;
        };
        granularity: "minute" | "hour" | "day" | "week" | "month" | "year";
        timestampUtc: string;
        timezoneOriginal: string;
        durationMinutes?: number | undefined;
        endTimestampUtc?: string | undefined;
    };
    conceptLinks: string[];
    archiveLink: string | null;
    createdAt: string;
    updatedAt: string;
}>;
/**
 * Options for creating an episode.
 */
interface CreateEpisodeOptions {
    /** Timestamp of the event (defaults to now) */
    timestamp?: Date;
    /** Timezone where event occurred */
    timezone?: string;
    /** How the timestamp was obtained */
    timeSource?: TimeSource;
    /** Precision of the timestamp */
    granularity?: TemporalGranularity;
    /** Concept IDs linked to this episode */
    conceptLinks?: string[];
    /** Archive node ID */
    archiveLink?: string | null;
    /** Duration in minutes */
    durationMinutes?: number;
}
/**
 * Creates a new episode with default values.
 *
 * @param type - Type of episode
 * @param summary - Brief description
 * @param options - Optional configuration
 * @returns New episode object
 *
 * @example
 * const episode = createEpisode('lecture', 'Fourier transforms lecture', {
 *   timestamp: new Date('2024-09-12T10:00:00Z'),
 *   timeSource: 'calendar_sync',
 *   granularity: 'hour'
 * });
 */
declare function createEpisode(type: EpisodeType, summary: string, options?: CreateEpisodeOptions): Episode;
/**
 * Creates default temporal metadata for an episode.
 */
declare function createEpisodeTemporalMetadata(timestamp: Date, options?: {
    timezone?: string;
    granularity?: TemporalGranularity;
    timeSource?: TimeSource;
}): EpisodeTemporalMetadata;
/**
 * Adds a concept link to an episode.
 */
declare function addConceptLink(episode: Episode, conceptId: string): Episode;
/**
 * Removes a concept link from an episode.
 */
declare function removeConceptLink(episode: Episode, conceptId: string): Episode;
/**
 * Sets the archive link for an episode.
 */
declare function setArchiveLink(episode: Episode, archiveId: string | null): Episode;
/**
 * Updates the summary of an episode.
 */
declare function updateEpisodeSummary(episode: Episode, summary: string): Episode;
/**
 * Calculates the overall confidence score for an episode's timestamp.
 */
declare function calculateEpisodeConfidence(episode: Episode): number;
/**
 * Checks if an episode has high temporal confidence.
 */
declare function hasHighConfidence(episode: Episode, threshold?: number): boolean;
/**
 * Checks if an episode falls within a time range.
 */
declare function isEpisodeInRange(episode: Episode, rangeStart: string, rangeEnd: string): boolean;
/**
 * Filters episodes by time range.
 */
declare function filterEpisodesByTimeRange(episodes: Episode[], rangeStart: string, rangeEnd: string): Episode[];
/**
 * Filters episodes by type.
 */
declare function filterEpisodesByType(episodes: Episode[], type: EpisodeType): Episode[];
/**
 * Sorts episodes by timestamp (newest first).
 */
declare function sortEpisodesByTime(episodes: Episode[]): Episode[];
/**
 * Sorts episodes by confidence (highest first).
 */
declare function sortEpisodesByConfidence(episodes: Episode[]): Episode[];
/**
 * Gets episodes that contain a specific concept.
 */
declare function getEpisodesWithConcept(episodes: Episode[], conceptId: string): Episode[];
/**
 * Gets the most recent episodes.
 */
declare function getMostRecentEpisodes(episodes: Episode[], limit?: number): Episode[];
/**
 * Factors contributing to a match score.
 */
interface MatchFactors {
    /** How well the temporal constraint matched */
    temporalMatch: number;
    /** Episode's own confidence */
    episodeConfidence: number;
    /** How well semantic entities matched */
    semanticMatch: number;
}
declare const MatchFactorsSchema: z.ZodObject<{
    temporalMatch: z.ZodNumber;
    episodeConfidence: z.ZodNumber;
    semanticMatch: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    temporalMatch: number;
    episodeConfidence: number;
    semanticMatch: number;
}, {
    temporalMatch: number;
    episodeConfidence: number;
    semanticMatch: number;
}>;
/**
 * Calculates overall match score from factors.
 * Formula: temporal × episode × semantic
 */
declare function calculateMatchScore(factors: MatchFactors): number;
/**
 * A matched episode with its confidence score.
 */
interface EpisodeMatch {
    /** The matched episode */
    episode: Episode;
    /** Overall match confidence */
    confidence: number;
    /** Individual match factors */
    matchFactors: MatchFactors;
}
declare const EpisodeMatchSchema: z.ZodObject<{
    episode: z.ZodObject<{
        id: z.ZodString;
        type: z.ZodUnion<[z.ZodEnum<["lecture", "meeting", "conversation", "note_session", "document_read", "thought", "external_event"]>, z.ZodString]>;
        summary: z.ZodString;
        conceptLinks: z.ZodArray<z.ZodString, "many">;
        archiveLink: z.ZodNullable<z.ZodString>;
        temporal: z.ZodObject<{
            timestampUtc: z.ZodString;
            timezoneOriginal: z.ZodString;
            granularity: z.ZodEnum<["minute", "hour", "day", "week", "month", "year"]>;
            confidence: z.ZodObject<{
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
            durationMinutes: z.ZodOptional<z.ZodNumber>;
            endTimestampUtc: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            confidence: {
                source: number;
                granularity: number;
                interpretation: number;
            };
            granularity: "minute" | "hour" | "day" | "week" | "month" | "year";
            timestampUtc: string;
            timezoneOriginal: string;
            durationMinutes?: number | undefined;
            endTimestampUtc?: string | undefined;
        }, {
            confidence: {
                source: number;
                granularity: number;
                interpretation: number;
            };
            granularity: "minute" | "hour" | "day" | "week" | "month" | "year";
            timestampUtc: string;
            timezoneOriginal: string;
            durationMinutes?: number | undefined;
            endTimestampUtc?: string | undefined;
        }>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: string;
        id: string;
        summary: string;
        temporal: {
            confidence: {
                source: number;
                granularity: number;
                interpretation: number;
            };
            granularity: "minute" | "hour" | "day" | "week" | "month" | "year";
            timestampUtc: string;
            timezoneOriginal: string;
            durationMinutes?: number | undefined;
            endTimestampUtc?: string | undefined;
        };
        conceptLinks: string[];
        archiveLink: string | null;
        createdAt: string;
        updatedAt: string;
    }, {
        type: string;
        id: string;
        summary: string;
        temporal: {
            confidence: {
                source: number;
                granularity: number;
                interpretation: number;
            };
            granularity: "minute" | "hour" | "day" | "week" | "month" | "year";
            timestampUtc: string;
            timezoneOriginal: string;
            durationMinutes?: number | undefined;
            endTimestampUtc?: string | undefined;
        };
        conceptLinks: string[];
        archiveLink: string | null;
        createdAt: string;
        updatedAt: string;
    }>;
    confidence: z.ZodNumber;
    matchFactors: z.ZodObject<{
        temporalMatch: z.ZodNumber;
        episodeConfidence: z.ZodNumber;
        semanticMatch: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        temporalMatch: number;
        episodeConfidence: number;
        semanticMatch: number;
    }, {
        temporalMatch: number;
        episodeConfidence: number;
        semanticMatch: number;
    }>;
}, "strip", z.ZodTypeAny, {
    episode: {
        type: string;
        id: string;
        summary: string;
        temporal: {
            confidence: {
                source: number;
                granularity: number;
                interpretation: number;
            };
            granularity: "minute" | "hour" | "day" | "week" | "month" | "year";
            timestampUtc: string;
            timezoneOriginal: string;
            durationMinutes?: number | undefined;
            endTimestampUtc?: string | undefined;
        };
        conceptLinks: string[];
        archiveLink: string | null;
        createdAt: string;
        updatedAt: string;
    };
    confidence: number;
    matchFactors: {
        temporalMatch: number;
        episodeConfidence: number;
        semanticMatch: number;
    };
}, {
    episode: {
        type: string;
        id: string;
        summary: string;
        temporal: {
            confidence: {
                source: number;
                granularity: number;
                interpretation: number;
            };
            granularity: "minute" | "hour" | "day" | "week" | "month" | "year";
            timestampUtc: string;
            timezoneOriginal: string;
            durationMinutes?: number | undefined;
            endTimestampUtc?: string | undefined;
        };
        conceptLinks: string[];
        archiveLink: string | null;
        createdAt: string;
        updatedAt: string;
    };
    confidence: number;
    matchFactors: {
        temporalMatch: number;
        episodeConfidence: number;
        semanticMatch: number;
    };
}>;
/**
 * Builds an episode match from an episode and match factors.
 */
declare function buildEpisodeMatch(episode: Episode, factors: MatchFactors): EpisodeMatch;
/**
 * Validates an episode against the schema.
 */
declare function validateEpisode(episode: unknown): episode is Episode;
/**
 * Parses and validates episode data.
 */
declare function parseEpisode(data: unknown): Episode;
/**
 * Safely parses episode data, returning null on failure.
 */
declare function safeParseEpisode(data: unknown): Episode | null;

export { type CreateEpisodeOptions, EPISODE_ID_PREFIX, EPISODE_TYPES, type Episode, type EpisodeMatch, EpisodeMatchSchema, EpisodeSchema, type EpisodeTemporalMetadata, EpisodeTemporalMetadataSchema, type EpisodeType, type MatchFactors, MatchFactorsSchema, TemporalGranularity, TimeSource, addConceptLink, buildEpisodeMatch, calculateEpisodeConfidence, calculateMatchScore, createEpisode, createEpisodeTemporalMetadata, filterEpisodesByTimeRange, filterEpisodesByType, generateEpisodeId, getEpisodesWithConcept, getMostRecentEpisodes, hasHighConfidence, isEpisodeInRange, parseEpisode, removeConceptLink, safeParseEpisode, setArchiveLink, sortEpisodesByConfidence, sortEpisodesByTime, updateEpisodeSummary, validateEpisode };
