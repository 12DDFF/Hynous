/**
 * @module @nous/core/episodes
 * @description Episode utilities with enhanced TPS metadata
 * @version 0.1.0
 * @spec Brainstorms/Specs/storm-004/spec/episode-schema.ts
 *
 * Episodes are time-indexed event containers that link
 * semantic concepts to temporal contexts.
 */

import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  NANOID_LENGTH,
  EPISODE_SUBTYPES,
  type EpisodeSubtype,
  type TemporalGranularity,
} from '../constants';
import {
  type ConfidenceFactors,
  type TimeSource,
  ConfidenceFactorsSchema,
  computeConfidenceScore,
  getSourceConfidence,
  getGranularityConfidence,
  TIME_SOURCES,
} from '../tps';

// ============================================================
// EPISODE ID
// ============================================================

/** Prefix for episode IDs */
export const EPISODE_ID_PREFIX = 'ep_';

/**
 * Generates a globally unique episode ID.
 * Format: "ep_" + nanoid(12)
 */
export function generateEpisodeId(): string {
  return EPISODE_ID_PREFIX + nanoid(NANOID_LENGTH);
}

// ============================================================
// EPISODE TYPES
// ============================================================

export const EPISODE_TYPES = EPISODE_SUBTYPES;
export type EpisodeType = EpisodeSubtype;

// ============================================================
// EPISODE TEMPORAL METADATA
// ============================================================

/**
 * Enhanced temporal metadata for episodes.
 * Includes three-factor confidence scoring.
 */
export interface EpisodeTemporalMetadata {
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

export const EpisodeTemporalMetadataSchema = z.object({
  timestampUtc: z.string().datetime(),
  timezoneOriginal: z.string().min(1),
  granularity: z.enum(['minute', 'hour', 'day', 'week', 'month', 'year']),
  confidence: ConfidenceFactorsSchema,
  durationMinutes: z.number().int().positive().optional(),
  endTimestampUtc: z.string().datetime().optional(),
});

// ============================================================
// EPISODE INTERFACE
// ============================================================

/**
 * An episode is a time-indexed event container.
 *
 * Episodes link:
 * - Temporal context (when it happened)
 * - Semantic concepts (what was learned/discussed)
 * - Archive sources (full content if needed)
 */
export interface Episode {
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

export const EpisodeSchema = z.object({
  id: z.string().regex(new RegExp(`^${EPISODE_ID_PREFIX}[a-zA-Z0-9_-]{${NANOID_LENGTH}}$`)),
  type: z.union([z.enum(EPISODE_TYPES), z.string().regex(/^custom:.+$/)]),
  summary: z.string().min(1),
  conceptLinks: z.array(z.string()),
  archiveLink: z.string().nullable(),
  temporal: EpisodeTemporalMetadataSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ============================================================
// FACTORY FUNCTIONS
// ============================================================

/**
 * Options for creating an episode.
 */
export interface CreateEpisodeOptions {
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
export function createEpisode(
  type: EpisodeType,
  summary: string,
  options: CreateEpisodeOptions = {}
): Episode {
  const now = new Date();
  const timestamp = options.timestamp ?? now;
  const granularity = options.granularity ?? 'day';
  const timeSource = options.timeSource ?? 'unknown';

  const confidence: ConfidenceFactors = {
    source: getSourceConfidence(timeSource),
    granularity: getGranularityConfidence(granularity),
    interpretation: 1.0, // Direct creation, no parsing needed
  };

  const temporal: EpisodeTemporalMetadata = {
    timestampUtc: timestamp.toISOString(),
    timezoneOriginal: options.timezone ?? 'UTC',
    granularity,
    confidence,
    durationMinutes: options.durationMinutes,
    endTimestampUtc: options.durationMinutes
      ? new Date(timestamp.getTime() + options.durationMinutes * 60 * 1000).toISOString()
      : undefined,
  };

  return {
    id: generateEpisodeId(),
    type,
    summary,
    conceptLinks: options.conceptLinks ?? [],
    archiveLink: options.archiveLink ?? null,
    temporal,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/**
 * Creates default temporal metadata for an episode.
 */
export function createEpisodeTemporalMetadata(
  timestamp: Date,
  options: {
    timezone?: string;
    granularity?: TemporalGranularity;
    timeSource?: TimeSource;
  } = {}
): EpisodeTemporalMetadata {
  const granularity = options.granularity ?? 'day';
  const timeSource = options.timeSource ?? 'unknown';

  return {
    timestampUtc: timestamp.toISOString(),
    timezoneOriginal: options.timezone ?? 'UTC',
    granularity,
    confidence: {
      source: getSourceConfidence(timeSource),
      granularity: getGranularityConfidence(granularity),
      interpretation: 1.0,
    },
  };
}

// ============================================================
// EPISODE OPERATIONS
// ============================================================

/**
 * Adds a concept link to an episode.
 */
export function addConceptLink(episode: Episode, conceptId: string): Episode {
  if (episode.conceptLinks.includes(conceptId)) {
    return episode;
  }
  return {
    ...episode,
    conceptLinks: [...episode.conceptLinks, conceptId],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Removes a concept link from an episode.
 */
export function removeConceptLink(episode: Episode, conceptId: string): Episode {
  if (!episode.conceptLinks.includes(conceptId)) {
    return episode;
  }
  return {
    ...episode,
    conceptLinks: episode.conceptLinks.filter((id) => id !== conceptId),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Sets the archive link for an episode.
 */
export function setArchiveLink(episode: Episode, archiveId: string | null): Episode {
  return {
    ...episode,
    archiveLink: archiveId,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Updates the summary of an episode.
 */
export function updateEpisodeSummary(episode: Episode, summary: string): Episode {
  return {
    ...episode,
    summary,
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================
// CONFIDENCE CALCULATION
// ============================================================

/**
 * Calculates the overall confidence score for an episode's timestamp.
 */
export function calculateEpisodeConfidence(episode: Episode): number {
  return computeConfidenceScore(episode.temporal.confidence);
}

/**
 * Checks if an episode has high temporal confidence.
 */
export function hasHighConfidence(episode: Episode, threshold: number = 0.7): boolean {
  return calculateEpisodeConfidence(episode) >= threshold;
}

// ============================================================
// TEMPORAL QUERIES
// ============================================================

/**
 * Checks if an episode falls within a time range.
 */
export function isEpisodeInRange(
  episode: Episode,
  rangeStart: string,
  rangeEnd: string
): boolean {
  const episodeTime = new Date(episode.temporal.timestampUtc).getTime();
  const start = new Date(rangeStart).getTime();
  const end = new Date(rangeEnd).getTime();

  return episodeTime >= start && episodeTime <= end;
}

/**
 * Filters episodes by time range.
 */
export function filterEpisodesByTimeRange(
  episodes: Episode[],
  rangeStart: string,
  rangeEnd: string
): Episode[] {
  return episodes.filter((ep) => isEpisodeInRange(ep, rangeStart, rangeEnd));
}

/**
 * Filters episodes by type.
 */
export function filterEpisodesByType(episodes: Episode[], type: EpisodeType): Episode[] {
  return episodes.filter((ep) => ep.type === type);
}

/**
 * Sorts episodes by timestamp (newest first).
 */
export function sortEpisodesByTime(episodes: Episode[]): Episode[] {
  return [...episodes].sort((a, b) => {
    const timeA = new Date(a.temporal.timestampUtc).getTime();
    const timeB = new Date(b.temporal.timestampUtc).getTime();
    return timeB - timeA;
  });
}

/**
 * Sorts episodes by confidence (highest first).
 */
export function sortEpisodesByConfidence(episodes: Episode[]): Episode[] {
  return [...episodes].sort((a, b) => {
    return calculateEpisodeConfidence(b) - calculateEpisodeConfidence(a);
  });
}

/**
 * Gets episodes that contain a specific concept.
 */
export function getEpisodesWithConcept(episodes: Episode[], conceptId: string): Episode[] {
  return episodes.filter((ep) => ep.conceptLinks.includes(conceptId));
}

/**
 * Gets the most recent episodes.
 */
export function getMostRecentEpisodes(episodes: Episode[], limit: number = 10): Episode[] {
  return sortEpisodesByTime(episodes).slice(0, limit);
}

// ============================================================
// MATCH FACTORS (for query flow)
// ============================================================

/**
 * Factors contributing to a match score.
 */
export interface MatchFactors {
  /** How well the temporal constraint matched */
  temporalMatch: number;
  /** Episode's own confidence */
  episodeConfidence: number;
  /** How well semantic entities matched */
  semanticMatch: number;
}

export const MatchFactorsSchema = z.object({
  temporalMatch: z.number().min(0).max(1),
  episodeConfidence: z.number().min(0).max(1),
  semanticMatch: z.number().min(0).max(1),
});

/**
 * Calculates overall match score from factors.
 * Formula: temporal × episode × semantic
 */
export function calculateMatchScore(factors: MatchFactors): number {
  return factors.temporalMatch * factors.episodeConfidence * factors.semanticMatch;
}

/**
 * A matched episode with its confidence score.
 */
export interface EpisodeMatch {
  /** The matched episode */
  episode: Episode;
  /** Overall match confidence */
  confidence: number;
  /** Individual match factors */
  matchFactors: MatchFactors;
}

export const EpisodeMatchSchema = z.object({
  episode: EpisodeSchema,
  confidence: z.number().min(0).max(1),
  matchFactors: MatchFactorsSchema,
});

/**
 * Builds an episode match from an episode and match factors.
 */
export function buildEpisodeMatch(episode: Episode, factors: MatchFactors): EpisodeMatch {
  return {
    episode,
    confidence: calculateMatchScore(factors),
    matchFactors: factors,
  };
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validates an episode against the schema.
 */
export function validateEpisode(episode: unknown): episode is Episode {
  return EpisodeSchema.safeParse(episode).success;
}

/**
 * Parses and validates episode data.
 */
export function parseEpisode(data: unknown): Episode {
  return EpisodeSchema.parse(data) as Episode;
}

/**
 * Safely parses episode data, returning null on failure.
 */
export function safeParseEpisode(data: unknown): Episode | null {
  const result = EpisodeSchema.safeParse(data);
  return result.success ? (result.data as Episode) : null;
}

// ============================================================
// RE-EXPORTS
// ============================================================

export type { TimeSource, TemporalGranularity };
export { TIME_SOURCES };
