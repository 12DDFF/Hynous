/**
 * @module @nous/core/episodes tests
 * @description Tests for Episode utilities with TPS metadata
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Constants
  EPISODE_ID_PREFIX,
  EPISODE_TYPES,
  TIME_SOURCES,

  // Types
  type Episode,
  type EpisodeType,
  type EpisodeTemporalMetadata,
  type CreateEpisodeOptions,
  type MatchFactors,
  type EpisodeMatch,

  // Functions
  generateEpisodeId,
  createEpisode,
  createEpisodeTemporalMetadata,
  addConceptLink,
  removeConceptLink,
  setArchiveLink,
  updateEpisodeSummary,
  calculateEpisodeConfidence,
  hasHighConfidence,
  isEpisodeInRange,
  filterEpisodesByTimeRange,
  filterEpisodesByType,
  sortEpisodesByTime,
  sortEpisodesByConfidence,
  getEpisodesWithConcept,
  getMostRecentEpisodes,
  calculateMatchScore,
  buildEpisodeMatch,
  validateEpisode,
  parseEpisode,
  safeParseEpisode,
} from './index';

describe('episodes/id', () => {
  describe('generateEpisodeId', () => {
    it('should generate ID with correct prefix', () => {
      const id = generateEpisodeId();
      expect(id.startsWith(EPISODE_ID_PREFIX)).toBe(true);
    });

    it('should generate unique IDs', () => {
      const id1 = generateEpisodeId();
      const id2 = generateEpisodeId();
      expect(id1).not.toBe(id2);
    });

    it('should generate ID with correct length', () => {
      const id = generateEpisodeId();
      expect(id.length).toBe(EPISODE_ID_PREFIX.length + 12);
    });
  });
});

describe('episodes/factory', () => {
  describe('createEpisode', () => {
    it('should create episode with defaults', () => {
      const episode = createEpisode('lecture', 'Test lecture');

      expect(episode.id).toMatch(/^ep_/);
      expect(episode.type).toBe('lecture');
      expect(episode.summary).toBe('Test lecture');
      expect(episode.conceptLinks).toEqual([]);
      expect(episode.archiveLink).toBeNull();
    });

    it('should create episode with custom options', () => {
      const timestamp = new Date('2024-09-12T10:00:00Z');
      const episode = createEpisode('meeting', 'Team sync', {
        timestamp,
        timezone: 'America/New_York',
        timeSource: 'calendar_sync',
        granularity: 'hour',
        conceptLinks: ['concept_123'],
        durationMinutes: 60,
      });

      expect(episode.temporal.timestampUtc).toBe(timestamp.toISOString());
      expect(episode.temporal.timezoneOriginal).toBe('America/New_York');
      expect(episode.temporal.granularity).toBe('hour');
      expect(episode.temporal.confidence.source).toBe(0.95);
      expect(episode.conceptLinks).toContain('concept_123');
      expect(episode.temporal.durationMinutes).toBe(60);
      expect(episode.temporal.endTimestampUtc).toBeDefined();
    });

    it('should calculate correct end timestamp for duration', () => {
      const timestamp = new Date('2024-09-12T10:00:00Z');
      const episode = createEpisode('meeting', 'One hour meeting', {
        timestamp,
        durationMinutes: 60,
      });

      const endTime = new Date(episode.temporal.endTimestampUtc!);
      expect(endTime.getTime() - timestamp.getTime()).toBe(60 * 60 * 1000);
    });
  });

  describe('createEpisodeTemporalMetadata', () => {
    it('should create temporal metadata with defaults', () => {
      const timestamp = new Date('2024-09-12T10:00:00Z');
      const metadata = createEpisodeTemporalMetadata(timestamp);

      expect(metadata.timestampUtc).toBe(timestamp.toISOString());
      expect(metadata.timezoneOriginal).toBe('UTC');
      expect(metadata.granularity).toBe('day');
    });

    it('should create temporal metadata with custom options', () => {
      const timestamp = new Date('2024-09-12T10:00:00Z');
      const metadata = createEpisodeTemporalMetadata(timestamp, {
        timezone: 'Europe/London',
        granularity: 'minute',
        timeSource: 'user_explicit',
      });

      expect(metadata.timezoneOriginal).toBe('Europe/London');
      expect(metadata.granularity).toBe('minute');
      expect(metadata.confidence.source).toBe(1.0);
    });
  });
});

describe('episodes/operations', () => {
  let episode: Episode;

  beforeEach(() => {
    episode = createEpisode('lecture', 'Test lecture');
  });

  describe('addConceptLink', () => {
    it('should add new concept link', () => {
      const updated = addConceptLink(episode, 'concept_123');
      expect(updated.conceptLinks).toContain('concept_123');
      // Updated episode should be a new object
      expect(updated).not.toBe(episode);
      expect(updated.conceptLinks).not.toBe(episode.conceptLinks);
    });

    it('should not duplicate concept link', () => {
      const first = addConceptLink(episode, 'concept_123');
      const second = addConceptLink(first, 'concept_123');
      expect(second.conceptLinks.filter((c) => c === 'concept_123')).toHaveLength(1);
    });
  });

  describe('removeConceptLink', () => {
    it('should remove existing concept link', () => {
      const withConcept = addConceptLink(episode, 'concept_123');
      const removed = removeConceptLink(withConcept, 'concept_123');
      expect(removed.conceptLinks).not.toContain('concept_123');
    });

    it('should return unchanged if concept not present', () => {
      const result = removeConceptLink(episode, 'nonexistent');
      expect(result).toBe(episode);
    });
  });

  describe('setArchiveLink', () => {
    it('should set archive link', () => {
      const updated = setArchiveLink(episode, 'raw_abc123');
      expect(updated.archiveLink).toBe('raw_abc123');
    });

    it('should clear archive link', () => {
      const withArchive = setArchiveLink(episode, 'raw_abc123');
      const cleared = setArchiveLink(withArchive, null);
      expect(cleared.archiveLink).toBeNull();
    });
  });

  describe('updateEpisodeSummary', () => {
    it('should update summary', () => {
      const updated = updateEpisodeSummary(episode, 'New summary');
      expect(updated.summary).toBe('New summary');
    });
  });
});

describe('episodes/confidence', () => {
  describe('calculateEpisodeConfidence', () => {
    it('should calculate combined confidence', () => {
      const episode = createEpisode('lecture', 'Test', {
        timeSource: 'calendar_sync',
        granularity: 'hour',
      });
      const confidence = calculateEpisodeConfidence(episode);
      // 0.95 (calendar_sync) * 0.9 (hour) * 1.0 (interpretation) = 0.855
      expect(confidence).toBeCloseTo(0.855, 2);
    });
  });

  describe('hasHighConfidence', () => {
    it('should return true for high confidence episode', () => {
      const episode = createEpisode('lecture', 'Test', {
        timeSource: 'user_explicit',
        granularity: 'minute',
      });
      expect(hasHighConfidence(episode)).toBe(true);
    });

    it('should return false for low confidence episode', () => {
      const episode = createEpisode('lecture', 'Test', {
        timeSource: 'unknown',
        granularity: 'month',
      });
      expect(hasHighConfidence(episode)).toBe(false);
    });

    it('should respect custom threshold', () => {
      const episode = createEpisode('lecture', 'Test', {
        timeSource: 'calendar_sync',
        granularity: 'day',
      });
      // 0.95 * 0.8 * 1.0 = 0.76
      expect(hasHighConfidence(episode, 0.75)).toBe(true);
      expect(hasHighConfidence(episode, 0.8)).toBe(false);
    });
  });
});

describe('episodes/temporal-queries', () => {
  const episodes: Episode[] = [];

  beforeEach(() => {
    episodes.length = 0;
    episodes.push(
      createEpisode('lecture', 'Lecture 1', {
        timestamp: new Date('2024-09-05T10:00:00Z'),
      }),
      createEpisode('lecture', 'Lecture 2', {
        timestamp: new Date('2024-09-12T10:00:00Z'),
      }),
      createEpisode('meeting', 'Meeting 1', {
        timestamp: new Date('2024-09-15T14:00:00Z'),
      }),
      createEpisode('lecture', 'Lecture 3', {
        timestamp: new Date('2024-10-01T10:00:00Z'),
      })
    );
  });

  describe('isEpisodeInRange', () => {
    it('should return true for episode in range', () => {
      const episode = episodes[0];
      expect(
        isEpisodeInRange(episode, '2024-09-01T00:00:00Z', '2024-09-30T23:59:59Z')
      ).toBe(true);
    });

    it('should return false for episode out of range', () => {
      const episode = episodes[3]; // October
      expect(
        isEpisodeInRange(episode, '2024-09-01T00:00:00Z', '2024-09-30T23:59:59Z')
      ).toBe(false);
    });
  });

  describe('filterEpisodesByTimeRange', () => {
    it('should filter to episodes in range', () => {
      const filtered = filterEpisodesByTimeRange(
        episodes,
        '2024-09-01T00:00:00Z',
        '2024-09-30T23:59:59Z'
      );
      expect(filtered).toHaveLength(3);
    });
  });

  describe('filterEpisodesByType', () => {
    it('should filter by type', () => {
      const lectures = filterEpisodesByType(episodes, 'lecture');
      expect(lectures).toHaveLength(3);

      const meetings = filterEpisodesByType(episodes, 'meeting');
      expect(meetings).toHaveLength(1);
    });
  });

  describe('sortEpisodesByTime', () => {
    it('should sort newest first', () => {
      const sorted = sortEpisodesByTime(episodes);
      expect(sorted[0].summary).toBe('Lecture 3');
      expect(sorted[sorted.length - 1].summary).toBe('Lecture 1');
    });

    it('should not mutate original array', () => {
      const original = [...episodes];
      sortEpisodesByTime(episodes);
      expect(episodes).toEqual(original);
    });
  });

  describe('sortEpisodesByConfidence', () => {
    it('should sort highest confidence first', () => {
      // Create episodes with different confidence levels
      const highConfidence = createEpisode('lecture', 'High', {
        timeSource: 'user_explicit',
        granularity: 'minute',
      });
      const lowConfidence = createEpisode('lecture', 'Low', {
        timeSource: 'unknown',
        granularity: 'month',
      });

      const sorted = sortEpisodesByConfidence([lowConfidence, highConfidence]);
      expect(sorted[0].summary).toBe('High');
    });
  });

  describe('getEpisodesWithConcept', () => {
    it('should return episodes containing concept', () => {
      episodes[0] = addConceptLink(episodes[0], 'concept_fourier');
      episodes[1] = addConceptLink(episodes[1], 'concept_fourier');

      const result = getEpisodesWithConcept(episodes, 'concept_fourier');
      expect(result).toHaveLength(2);
    });

    it('should return empty array if no matches', () => {
      const result = getEpisodesWithConcept(episodes, 'nonexistent');
      expect(result).toHaveLength(0);
    });
  });

  describe('getMostRecentEpisodes', () => {
    it('should return most recent episodes', () => {
      const recent = getMostRecentEpisodes(episodes, 2);
      expect(recent).toHaveLength(2);
      expect(recent[0].summary).toBe('Lecture 3');
      expect(recent[1].summary).toBe('Meeting 1');
    });

    it('should default to 10 episodes', () => {
      const recent = getMostRecentEpisodes(episodes);
      expect(recent).toHaveLength(4); // Only 4 episodes exist
    });
  });
});

describe('episodes/matching', () => {
  describe('calculateMatchScore', () => {
    it('should calculate combined match score', () => {
      const factors: MatchFactors = {
        temporalMatch: 1.0,
        episodeConfidence: 0.95,
        semanticMatch: 0.9,
      };
      expect(calculateMatchScore(factors)).toBeCloseTo(0.855, 2);
    });
  });

  describe('buildEpisodeMatch', () => {
    it('should build episode match with calculated confidence', () => {
      const episode = createEpisode('lecture', 'Test');
      const factors: MatchFactors = {
        temporalMatch: 1.0,
        episodeConfidence: 0.8,
        semanticMatch: 0.9,
      };
      const match = buildEpisodeMatch(episode, factors);

      expect(match.episode).toBe(episode);
      expect(match.matchFactors).toBe(factors);
      expect(match.confidence).toBeCloseTo(0.72, 2);
    });
  });
});

describe('episodes/validation', () => {
  describe('validateEpisode', () => {
    it('should validate correct episode', () => {
      const episode = createEpisode('lecture', 'Test');
      expect(validateEpisode(episode)).toBe(true);
    });

    it('should reject invalid episode', () => {
      expect(validateEpisode({ id: 'invalid' })).toBe(false);
      expect(validateEpisode(null)).toBe(false);
    });
  });

  describe('parseEpisode', () => {
    it('should parse valid episode data', () => {
      const episode = createEpisode('lecture', 'Test');
      const parsed = parseEpisode(episode);
      expect(parsed).toEqual(episode);
    });

    it('should throw on invalid data', () => {
      expect(() => parseEpisode({ id: 'invalid' })).toThrow();
    });
  });

  describe('safeParseEpisode', () => {
    it('should return episode for valid data', () => {
      const episode = createEpisode('lecture', 'Test');
      const parsed = safeParseEpisode(episode);
      expect(parsed).toEqual(episode);
    });

    it('should return null for invalid data', () => {
      const parsed = safeParseEpisode({ id: 'invalid' });
      expect(parsed).toBeNull();
    });
  });
});
