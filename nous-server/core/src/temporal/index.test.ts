/**
 * @module @nous/core/temporal
 * @description Tests for temporal module - Four-type temporal model
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTemporalModel,
  addEventTime,
  addContentTime,
  addReferencePattern,
  calculateTemporalConfidence,
  matchesTimeRange,
  getPrimaryTimestamp,
  matchesReferencePattern,
  TemporalModelSchema,
  type TemporalModel,
  type ContentTime,
} from './index';

describe('Temporal Module', () => {
  describe('createTemporalModel', () => {
    it('should create a temporal model with ingestion time', () => {
      const temporal = createTemporalModel();

      expect(temporal.ingestion).toBeDefined();
      expect(temporal.ingestion.timestamp).toBeDefined();
      expect(temporal.ingestion.timezone).toBeDefined();
    });

    it('should use provided timezone', () => {
      const temporal = createTemporalModel('America/New_York');

      expect(temporal.ingestion.timezone).toBe('America/New_York');
    });

    it('should create valid ISO timestamps', () => {
      const temporal = createTemporalModel();
      const date = new Date(temporal.ingestion.timestamp);

      expect(date.toISOString()).toBe(temporal.ingestion.timestamp);
    });
  });

  describe('addEventTime', () => {
    it('should add event time to temporal model', () => {
      const temporal = createTemporalModel();
      const eventDate = '2024-01-15T10:30:00.000Z';

      const updated = addEventTime(temporal, eventDate, 'explicit', 0.95);

      expect(updated.event).toBeDefined();
      expect(updated.event?.timestamp).toBe(eventDate);
      expect(updated.event?.source).toBe('explicit');
      expect(updated.event?.confidence).toBe(0.95);
    });

    it('should handle Date objects', () => {
      const temporal = createTemporalModel();
      const eventDate = new Date('2024-01-15T10:30:00.000Z');

      const updated = addEventTime(temporal, eventDate, 'user_stated');

      expect(updated.event?.timestamp).toBe(eventDate.toISOString());
    });

    it('should default confidence to 1.0', () => {
      const temporal = createTemporalModel();

      const updated = addEventTime(temporal, new Date(), 'explicit');

      expect(updated.event?.confidence).toBe(1.0);
    });
  });

  describe('addContentTime', () => {
    it('should add content time reference', () => {
      const temporal = createTemporalModel();
      const contentTime: ContentTime = {
        text: 'last Tuesday',
        resolved: '2024-01-09T00:00:00.000Z',
        type: 'relative',
        confidence: 0.8,
      };

      const updated = addContentTime(temporal, contentTime);

      expect(updated.content_times).toHaveLength(1);
      expect(updated.content_times?.[0].text).toBe('last Tuesday');
    });

    it('should accumulate multiple content times', () => {
      let temporal = createTemporalModel();

      temporal = addContentTime(temporal, {
        text: 'yesterday',
        resolved: '2024-01-14T00:00:00.000Z',
        type: 'relative',
        confidence: 0.9,
      });

      temporal = addContentTime(temporal, {
        text: 'in 1990',
        resolved: '1990-01-01T00:00:00.000Z',
        type: 'historical',
        confidence: 0.95,
      });

      expect(temporal.content_times).toHaveLength(2);
    });
  });

  describe('addReferencePattern', () => {
    it('should add reference pattern', () => {
      const temporal = createTemporalModel();

      const updated = addReferencePattern(temporal, 'that meeting with John');

      expect(updated.reference_patterns).toContain('that meeting with John');
    });

    it('should not duplicate patterns', () => {
      let temporal = createTemporalModel();

      temporal = addReferencePattern(temporal, 'the conference');
      temporal = addReferencePattern(temporal, 'the conference');

      expect(temporal.reference_patterns).toHaveLength(1);
    });

    it('should accumulate different patterns', () => {
      let temporal = createTemporalModel();

      temporal = addReferencePattern(temporal, 'the conference');
      temporal = addReferencePattern(temporal, 'WWDC 2024');

      expect(temporal.reference_patterns).toHaveLength(2);
    });
  });

  describe('calculateTemporalConfidence', () => {
    it('should calculate combined confidence', () => {
      const confidence = calculateTemporalConfidence(0.9, 0.8, 0.7);

      expect(confidence.source).toBe(0.9);
      expect(confidence.granularity).toBe(0.8);
      expect(confidence.interpretation).toBe(0.7);
      expect(confidence.combined).toBe(0.9 * 0.8 * 0.7);
    });

    it('should handle perfect confidence', () => {
      const confidence = calculateTemporalConfidence(1.0, 1.0, 1.0);

      expect(confidence.combined).toBe(1.0);
    });

    it('should handle zero confidence', () => {
      const confidence = calculateTemporalConfidence(0, 0.5, 0.5);

      expect(confidence.combined).toBe(0);
    });
  });

  describe('matchesTimeRange', () => {
    let temporal: TemporalModel;

    beforeEach(() => {
      temporal = createTemporalModel();
      temporal = addEventTime(temporal, '2024-01-15T10:00:00.000Z', 'explicit');
      temporal = addContentTime(temporal, {
        text: '2020',
        resolved: '2020-06-15T00:00:00.000Z',
        type: 'historical',
        confidence: 1.0,
      });
    });

    it('should match by ingestion time', () => {
      const now = new Date();
      const start = new Date(now.getTime() - 60000).toISOString();
      const end = new Date(now.getTime() + 60000).toISOString();

      expect(matchesTimeRange(temporal, start, end, 'ingestion')).toBe(true);
    });

    it('should match by event time', () => {
      expect(
        matchesTimeRange(
          temporal,
          '2024-01-01T00:00:00.000Z',
          '2024-01-31T00:00:00.000Z',
          'event'
        )
      ).toBe(true);
    });

    it('should not match event time outside range', () => {
      expect(
        matchesTimeRange(
          temporal,
          '2023-01-01T00:00:00.000Z',
          '2023-12-31T00:00:00.000Z',
          'event'
        )
      ).toBe(false);
    });

    it('should match by content time', () => {
      expect(
        matchesTimeRange(
          temporal,
          '2020-01-01T00:00:00.000Z',
          '2020-12-31T00:00:00.000Z',
          'content'
        )
      ).toBe(true);
    });

    it('should match any type by default', () => {
      expect(
        matchesTimeRange(
          temporal,
          '2020-01-01T00:00:00.000Z',
          '2020-12-31T00:00:00.000Z'
        )
      ).toBe(true);
    });
  });

  describe('getPrimaryTimestamp', () => {
    it('should return event time when available', () => {
      let temporal = createTemporalModel();
      const eventTime = '2024-01-15T10:00:00.000Z';
      temporal = addEventTime(temporal, eventTime, 'explicit');

      expect(getPrimaryTimestamp(temporal)).toBe(eventTime);
    });

    it('should fall back to ingestion time', () => {
      const temporal = createTemporalModel();

      expect(getPrimaryTimestamp(temporal)).toBe(temporal.ingestion.timestamp);
    });
  });

  describe('matchesReferencePattern', () => {
    it('should match reference patterns', () => {
      let temporal = createTemporalModel();
      temporal = addReferencePattern(temporal, 'WWDC conference');

      expect(matchesReferencePattern(temporal, 'wwdc')).toBe(true);
      expect(matchesReferencePattern(temporal, 'conference')).toBe(true);
    });

    it('should be case insensitive', () => {
      let temporal = createTemporalModel();
      temporal = addReferencePattern(temporal, 'Meeting with John');

      expect(matchesReferencePattern(temporal, 'MEETING')).toBe(true);
      expect(matchesReferencePattern(temporal, 'john')).toBe(true);
    });

    it('should return false with no patterns', () => {
      const temporal = createTemporalModel();

      expect(matchesReferencePattern(temporal, 'anything')).toBe(false);
    });
  });

  describe('Schema Validation', () => {
    it('should validate a complete temporal model', () => {
      let temporal = createTemporalModel();
      temporal = addEventTime(temporal, new Date(), 'explicit');
      temporal = addContentTime(temporal, {
        text: 'yesterday',
        resolved: new Date().toISOString(),
        type: 'relative',
        confidence: 0.9,
      });
      temporal = addReferencePattern(temporal, 'test pattern');

      const result = TemporalModelSchema.safeParse(temporal);
      expect(result.success).toBe(true);
    });

    it('should reject invalid timestamps', () => {
      const invalid = {
        ingestion: {
          timestamp: 'not-a-date',
          timezone: 'UTC',
        },
      };

      const result = TemporalModelSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});
