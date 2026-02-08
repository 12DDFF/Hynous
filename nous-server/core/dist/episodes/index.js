import { z } from 'zod';
import { nanoid } from 'nanoid';

// src/episodes/index.ts

// src/constants.ts
var NANOID_LENGTH = 12;
var EPISODE_SUBTYPES = [
  "lecture",
  "meeting",
  "conversation",
  "note_session",
  "document_read",
  "thought",
  "external_event"
];
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
z.object({
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
z.object({
  temporalConstraint: TemporalConstraintSchema.nullable(),
  entitiesExtracted: z.array(z.string()),
  parsingConfidence: z.number().min(0).max(1)
});

// src/episodes/index.ts
var EPISODE_ID_PREFIX = "ep_";
function generateEpisodeId() {
  return EPISODE_ID_PREFIX + nanoid(NANOID_LENGTH);
}
var EPISODE_TYPES = EPISODE_SUBTYPES;
var EpisodeTemporalMetadataSchema = z.object({
  timestampUtc: z.string().datetime(),
  timezoneOriginal: z.string().min(1),
  granularity: z.enum(["minute", "hour", "day", "week", "month", "year"]),
  confidence: ConfidenceFactorsSchema,
  durationMinutes: z.number().int().positive().optional(),
  endTimestampUtc: z.string().datetime().optional()
});
var EpisodeSchema = z.object({
  id: z.string().regex(new RegExp(`^${EPISODE_ID_PREFIX}[a-zA-Z0-9_-]{${NANOID_LENGTH}}$`)),
  type: z.union([z.enum(EPISODE_TYPES), z.string().regex(/^custom:.+$/)]),
  summary: z.string().min(1),
  conceptLinks: z.array(z.string()),
  archiveLink: z.string().nullable(),
  temporal: EpisodeTemporalMetadataSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
function createEpisode(type, summary, options = {}) {
  const now = /* @__PURE__ */ new Date();
  const timestamp = options.timestamp ?? now;
  const granularity = options.granularity ?? "day";
  const timeSource = options.timeSource ?? "unknown";
  const confidence = {
    source: getSourceConfidence(timeSource),
    granularity: getGranularityConfidence(granularity),
    interpretation: 1
    // Direct creation, no parsing needed
  };
  const temporal = {
    timestampUtc: timestamp.toISOString(),
    timezoneOriginal: options.timezone ?? "UTC",
    granularity,
    confidence,
    durationMinutes: options.durationMinutes,
    endTimestampUtc: options.durationMinutes ? new Date(timestamp.getTime() + options.durationMinutes * 60 * 1e3).toISOString() : void 0
  };
  return {
    id: generateEpisodeId(),
    type,
    summary,
    conceptLinks: options.conceptLinks ?? [],
    archiveLink: options.archiveLink ?? null,
    temporal,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}
function createEpisodeTemporalMetadata(timestamp, options = {}) {
  const granularity = options.granularity ?? "day";
  const timeSource = options.timeSource ?? "unknown";
  return {
    timestampUtc: timestamp.toISOString(),
    timezoneOriginal: options.timezone ?? "UTC",
    granularity,
    confidence: {
      source: getSourceConfidence(timeSource),
      granularity: getGranularityConfidence(granularity),
      interpretation: 1
    }
  };
}
function addConceptLink(episode, conceptId) {
  if (episode.conceptLinks.includes(conceptId)) {
    return episode;
  }
  return {
    ...episode,
    conceptLinks: [...episode.conceptLinks, conceptId],
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function removeConceptLink(episode, conceptId) {
  if (!episode.conceptLinks.includes(conceptId)) {
    return episode;
  }
  return {
    ...episode,
    conceptLinks: episode.conceptLinks.filter((id) => id !== conceptId),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function setArchiveLink(episode, archiveId) {
  return {
    ...episode,
    archiveLink: archiveId,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function updateEpisodeSummary(episode, summary) {
  return {
    ...episode,
    summary,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function calculateEpisodeConfidence(episode) {
  return computeConfidenceScore(episode.temporal.confidence);
}
function hasHighConfidence(episode, threshold = 0.7) {
  return calculateEpisodeConfidence(episode) >= threshold;
}
function isEpisodeInRange(episode, rangeStart, rangeEnd) {
  const episodeTime = new Date(episode.temporal.timestampUtc).getTime();
  const start = new Date(rangeStart).getTime();
  const end = new Date(rangeEnd).getTime();
  return episodeTime >= start && episodeTime <= end;
}
function filterEpisodesByTimeRange(episodes, rangeStart, rangeEnd) {
  return episodes.filter((ep) => isEpisodeInRange(ep, rangeStart, rangeEnd));
}
function filterEpisodesByType(episodes, type) {
  return episodes.filter((ep) => ep.type === type);
}
function sortEpisodesByTime(episodes) {
  return [...episodes].sort((a, b) => {
    const timeA = new Date(a.temporal.timestampUtc).getTime();
    const timeB = new Date(b.temporal.timestampUtc).getTime();
    return timeB - timeA;
  });
}
function sortEpisodesByConfidence(episodes) {
  return [...episodes].sort((a, b) => {
    return calculateEpisodeConfidence(b) - calculateEpisodeConfidence(a);
  });
}
function getEpisodesWithConcept(episodes, conceptId) {
  return episodes.filter((ep) => ep.conceptLinks.includes(conceptId));
}
function getMostRecentEpisodes(episodes, limit = 10) {
  return sortEpisodesByTime(episodes).slice(0, limit);
}
var MatchFactorsSchema = z.object({
  temporalMatch: z.number().min(0).max(1),
  episodeConfidence: z.number().min(0).max(1),
  semanticMatch: z.number().min(0).max(1)
});
function calculateMatchScore(factors) {
  return factors.temporalMatch * factors.episodeConfidence * factors.semanticMatch;
}
var EpisodeMatchSchema = z.object({
  episode: EpisodeSchema,
  confidence: z.number().min(0).max(1),
  matchFactors: MatchFactorsSchema
});
function buildEpisodeMatch(episode, factors) {
  return {
    episode,
    confidence: calculateMatchScore(factors),
    matchFactors: factors
  };
}
function validateEpisode(episode) {
  return EpisodeSchema.safeParse(episode).success;
}
function parseEpisode(data) {
  return EpisodeSchema.parse(data);
}
function safeParseEpisode(data) {
  const result = EpisodeSchema.safeParse(data);
  return result.success ? result.data : null;
}

export { EPISODE_ID_PREFIX, EPISODE_TYPES, EpisodeMatchSchema, EpisodeSchema, EpisodeTemporalMetadataSchema, MatchFactorsSchema, TIME_SOURCES, addConceptLink, buildEpisodeMatch, calculateEpisodeConfidence, calculateMatchScore, createEpisode, createEpisodeTemporalMetadata, filterEpisodesByTimeRange, filterEpisodesByType, generateEpisodeId, getEpisodesWithConcept, getMostRecentEpisodes, hasHighConfidence, isEpisodeInRange, parseEpisode, removeConceptLink, safeParseEpisode, setArchiveLink, sortEpisodesByConfidence, sortEpisodesByTime, updateEpisodeSummary, validateEpisode };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map