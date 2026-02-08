/**
 * @module @nous/core/constants
 * @description Tests for constants module
 */

import { describe, it, expect } from 'vitest';
import {
  NANOID_LENGTH,
  NODE_ID_PREFIX,
  BLOCK_ID_PREFIX,
  EDGE_ID_PREFIX,
  EDIT_ID_PREFIX,
  NODE_TYPES,
  CONCEPT_SUBTYPES,
  EPISODE_SUBTYPES,
  RAW_SUBTYPES,
  BLOCK_TYPES,
  EDGE_TYPES,
  LIFECYCLE_STATES,
  SOURCE_TYPES,
  CONTENT_SOURCES,
  EDIT_TARGET_METHODS,
  EDIT_ACTIONS,
  MODIFIERS,
  EDIT_HISTORY_RETENTION,
  TEMPORAL_GRANULARITIES,
  EVENT_TIME_SOURCES,
  CONTENT_TIME_TYPES,
  INPUT_TYPES,
  INPUT_SIZES,
  PROCESSING_PATHS,
  SIZE_THRESHOLDS,
  BLOCK_LENGTH_THRESHOLD,
  BLOCK_LIST_THRESHOLD,
  NEURAL_DEFAULTS,
  EXTRACTION_DEPTHS,
  HEADING_PATTERN,
  LIST_ITEM_PATTERN,
} from './constants';

describe('Constants Module', () => {
  describe('ID Configuration', () => {
    it('should have correct nanoid length', () => {
      expect(NANOID_LENGTH).toBe(12);
    });

    it('should have correct prefixes', () => {
      expect(NODE_ID_PREFIX).toBe('n_');
      expect(BLOCK_ID_PREFIX).toBe('b_');
      expect(EDGE_ID_PREFIX).toBe('e_');
      expect(EDIT_ID_PREFIX).toBe('edit_');
    });
  });

  describe('Node Types', () => {
    it('should have all 7 node types', () => {
      expect(NODE_TYPES).toHaveLength(7);
      expect(NODE_TYPES).toContain('concept');
      expect(NODE_TYPES).toContain('episode');
      expect(NODE_TYPES).toContain('document');
      expect(NODE_TYPES).toContain('section');
      expect(NODE_TYPES).toContain('chunk');
      expect(NODE_TYPES).toContain('note');
      expect(NODE_TYPES).toContain('raw');
    });
  });

  describe('Subtypes', () => {
    it('should have concept subtypes', () => {
      expect(CONCEPT_SUBTYPES.length).toBeGreaterThan(0);
      expect(CONCEPT_SUBTYPES).toContain('fact');
      expect(CONCEPT_SUBTYPES).toContain('definition');
      expect(CONCEPT_SUBTYPES).toContain('preference');
    });

    it('should have episode subtypes', () => {
      expect(EPISODE_SUBTYPES.length).toBeGreaterThan(0);
      expect(EPISODE_SUBTYPES).toContain('lecture');
      expect(EPISODE_SUBTYPES).toContain('meeting');
      expect(EPISODE_SUBTYPES).toContain('conversation');
    });

    it('should have raw subtypes', () => {
      expect(RAW_SUBTYPES.length).toBeGreaterThan(0);
      expect(RAW_SUBTYPES).toContain('transcript');
      expect(RAW_SUBTYPES).toContain('document');
    });
  });

  describe('Block Types', () => {
    it('should have all block types', () => {
      expect(BLOCK_TYPES).toContain('paragraph');
      expect(BLOCK_TYPES).toContain('heading');
      expect(BLOCK_TYPES).toContain('list');
      expect(BLOCK_TYPES).toContain('code');
      expect(BLOCK_TYPES).toContain('quote');
    });
  });

  describe('Edge Types', () => {
    it('should have all edge types', () => {
      expect(EDGE_TYPES).toContain('relates_to');
      expect(EDGE_TYPES).toContain('part_of');
      expect(EDGE_TYPES).toContain('causes');
      expect(EDGE_TYPES).toContain('contradicts');
      expect(EDGE_TYPES).toContain('supersedes');
    });
  });

  describe('Lifecycle States', () => {
    it('should have all lifecycle states', () => {
      expect(LIFECYCLE_STATES).toContain('working');
      expect(LIFECYCLE_STATES).toContain('active');
      expect(LIFECYCLE_STATES).toContain('superseded');
      expect(LIFECYCLE_STATES).toContain('dormant');
      expect(LIFECYCLE_STATES).toContain('archived');
    });
  });

  describe('Source Types', () => {
    it('should have all source types', () => {
      expect(SOURCE_TYPES).toContain('extraction');
      expect(SOURCE_TYPES).toContain('manual');
      expect(SOURCE_TYPES).toContain('inference');
      expect(SOURCE_TYPES).toContain('import');
    });
  });

  describe('Edit System', () => {
    it('should have target methods', () => {
      expect(EDIT_TARGET_METHODS).toContain('block_id');
      expect(EDIT_TARGET_METHODS).toContain('heading');
      expect(EDIT_TARGET_METHODS).toContain('position');
      expect(EDIT_TARGET_METHODS).toContain('search');
      expect(EDIT_TARGET_METHODS).toContain('full');
    });

    it('should have edit actions', () => {
      expect(EDIT_ACTIONS).toContain('replace');
      expect(EDIT_ACTIONS).toContain('insert');
      expect(EDIT_ACTIONS).toContain('append');
      expect(EDIT_ACTIONS).toContain('delete');
    });

    it('should have modifiers', () => {
      expect(MODIFIERS).toContain('user');
      expect(MODIFIERS).toContain('ai');
      expect(MODIFIERS).toContain('system');
      expect(MODIFIERS).toContain('sync');
    });

    it('should have edit history retention config', () => {
      expect(EDIT_HISTORY_RETENTION.maxEdits).toBe(100);
      expect(EDIT_HISTORY_RETENTION.maxAgeDays).toBe(30);
      expect(EDIT_HISTORY_RETENTION.undoWindowHours).toBe(24);
    });
  });

  describe('Temporal', () => {
    it('should have granularities', () => {
      expect(TEMPORAL_GRANULARITIES).toContain('minute');
      expect(TEMPORAL_GRANULARITIES).toContain('hour');
      expect(TEMPORAL_GRANULARITIES).toContain('day');
    });

    it('should have event time sources', () => {
      expect(EVENT_TIME_SOURCES).toContain('explicit');
      expect(EVENT_TIME_SOURCES).toContain('inferred');
      expect(EVENT_TIME_SOURCES).toContain('user_stated');
    });

    it('should have content time types', () => {
      expect(CONTENT_TIME_TYPES).toContain('historical');
      expect(CONTENT_TIME_TYPES).toContain('relative');
      expect(CONTENT_TIME_TYPES).toContain('approximate');
    });
  });

  describe('Processing', () => {
    it('should have input types', () => {
      expect(INPUT_TYPES).toContain('DOCUMENT');
      expect(INPUT_TYPES).toContain('TRANSCRIPT');
      expect(INPUT_TYPES).toContain('NOTE');
    });

    it('should have input sizes', () => {
      expect(INPUT_SIZES).toContain('tiny');
      expect(INPUT_SIZES).toContain('small');
      expect(INPUT_SIZES).toContain('medium');
      expect(INPUT_SIZES).toContain('large');
      expect(INPUT_SIZES).toContain('huge');
    });

    it('should have size thresholds', () => {
      expect(SIZE_THRESHOLDS.tiny.max).toBe(50);
      expect(SIZE_THRESHOLDS.small.min).toBe(50);
      expect(SIZE_THRESHOLDS.huge.max).toBe(Infinity);
    });
  });

  describe('Block Decision Thresholds', () => {
    it('should have correct block thresholds', () => {
      expect(BLOCK_LENGTH_THRESHOLD).toBe(1000);
      expect(BLOCK_LIST_THRESHOLD).toBe(3);
    });
  });

  describe('Neural Defaults', () => {
    it('should have neural default values', () => {
      expect(NEURAL_DEFAULTS.stability).toBe(0.5);
      expect(NEURAL_DEFAULTS.retrievability).toBe(1.0);
      expect(NEURAL_DEFAULTS.accessCount).toBe(0);
    });
  });

  describe('Extraction Depths', () => {
    it('should have extraction depth levels', () => {
      expect(EXTRACTION_DEPTHS).toContain('summary');
      expect(EXTRACTION_DEPTHS).toContain('section');
      expect(EXTRACTION_DEPTHS).toContain('full');
    });
  });

  describe('Regex Patterns', () => {
    it('should match markdown headings', () => {
      expect(HEADING_PATTERN.test('# Heading')).toBe(true);
      expect(HEADING_PATTERN.test('## Heading')).toBe(true);
      expect(HEADING_PATTERN.test('### Heading')).toBe(true);
      expect(HEADING_PATTERN.test('Not a heading')).toBe(false);
    });

    it('should match list items', () => {
      const content = '- item 1\n- item 2\n- item 3';
      const matches = content.match(LIST_ITEM_PATTERN);
      expect(matches).toHaveLength(3);
    });
  });
});
