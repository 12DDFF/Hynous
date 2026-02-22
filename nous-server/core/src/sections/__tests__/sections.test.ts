import { describe, it, expect } from 'vitest';
import {
  MEMORY_SECTIONS,
  SUBTYPE_TO_SECTION,
  SECTION_PROFILES,
  SUBTYPE_INITIAL_STABILITY,
  getSectionForSubtype,
  getInitialStabilityForSubtype,
  validateSectionProfiles,
} from '../index.js';

describe('sections', () => {
  describe('MEMORY_SECTIONS', () => {
    it('has exactly 4 sections', () => {
      expect(MEMORY_SECTIONS).toHaveLength(4);
    });

    it('contains EPISODIC, SIGNALS, KNOWLEDGE, PROCEDURAL', () => {
      expect(MEMORY_SECTIONS).toContain('EPISODIC');
      expect(MEMORY_SECTIONS).toContain('SIGNALS');
      expect(MEMORY_SECTIONS).toContain('KNOWLEDGE');
      expect(MEMORY_SECTIONS).toContain('PROCEDURAL');
    });
  });

  describe('SUBTYPE_TO_SECTION', () => {
    it('maps all 15 custom subtypes', () => {
      expect(Object.keys(SUBTYPE_TO_SECTION)).toHaveLength(15);
    });

    it('maps trade subtypes to EPISODIC', () => {
      expect(SUBTYPE_TO_SECTION['custom:trade_entry']).toBe('EPISODIC');
      expect(SUBTYPE_TO_SECTION['custom:trade_close']).toBe('EPISODIC');
      expect(SUBTYPE_TO_SECTION['custom:trade_modify']).toBe('EPISODIC');
      expect(SUBTYPE_TO_SECTION['custom:trade']).toBe('EPISODIC');
      expect(SUBTYPE_TO_SECTION['custom:turn_summary']).toBe('EPISODIC');
      expect(SUBTYPE_TO_SECTION['custom:session_summary']).toBe('EPISODIC');
      expect(SUBTYPE_TO_SECTION['custom:market_event']).toBe('EPISODIC');
    });

    it('maps signal subtypes to SIGNALS', () => {
      expect(SUBTYPE_TO_SECTION['custom:signal']).toBe('SIGNALS');
      expect(SUBTYPE_TO_SECTION['custom:watchpoint']).toBe('SIGNALS');
    });

    it('maps knowledge subtypes to KNOWLEDGE', () => {
      expect(SUBTYPE_TO_SECTION['custom:lesson']).toBe('KNOWLEDGE');
      expect(SUBTYPE_TO_SECTION['custom:thesis']).toBe('KNOWLEDGE');
      expect(SUBTYPE_TO_SECTION['custom:curiosity']).toBe('KNOWLEDGE');
    });

    it('maps procedural subtypes to PROCEDURAL', () => {
      expect(SUBTYPE_TO_SECTION['custom:playbook']).toBe('PROCEDURAL');
      expect(SUBTYPE_TO_SECTION['custom:missed_opportunity']).toBe('PROCEDURAL');
      expect(SUBTYPE_TO_SECTION['custom:good_pass']).toBe('PROCEDURAL');
    });
  });

  describe('getSectionForSubtype', () => {
    it('returns correct section for known subtypes', () => {
      expect(getSectionForSubtype('custom:signal')).toBe('SIGNALS');
      expect(getSectionForSubtype('custom:lesson')).toBe('KNOWLEDGE');
      expect(getSectionForSubtype('custom:trade_entry')).toBe('EPISODIC');
      expect(getSectionForSubtype('custom:playbook')).toBe('PROCEDURAL');
    });

    it('returns KNOWLEDGE for unknown subtypes', () => {
      expect(getSectionForSubtype('custom:unknown')).toBe('KNOWLEDGE');
      expect(getSectionForSubtype('anything')).toBe('KNOWLEDGE');
    });

    it('returns KNOWLEDGE for null/undefined', () => {
      expect(getSectionForSubtype(null)).toBe('KNOWLEDGE');
      expect(getSectionForSubtype(undefined)).toBe('KNOWLEDGE');
    });
  });

  describe('SECTION_PROFILES', () => {
    it('has a profile for every section', () => {
      for (const section of MEMORY_SECTIONS) {
        expect(SECTION_PROFILES[section]).toBeDefined();
      }
    });

    it('all reranking weights sum to 1.0', () => {
      for (const [section, profile] of Object.entries(SECTION_PROFILES)) {
        const w = profile.reranking_weights;
        const sum = w.semantic + w.keyword + w.graph + w.recency + w.authority + w.affinity;
        expect(sum).toBeCloseTo(1.0, 2);
      }
    });

    it('all decay configs have valid thresholds', () => {
      for (const [section, profile] of Object.entries(SECTION_PROFILES)) {
        expect(profile.decay.weak_threshold).toBeLessThan(profile.decay.active_threshold);
        expect(profile.decay.initial_stability_days).toBeGreaterThan(0);
        expect(profile.decay.max_stability_days).toBeGreaterThan(profile.decay.initial_stability_days);
      }
    });

    it('validateSectionProfiles does not throw', () => {
      expect(() => validateSectionProfiles()).not.toThrow();
    });
  });

  describe('getInitialStabilityForSubtype', () => {
    it('returns per-subtype override when available', () => {
      expect(getInitialStabilityForSubtype('custom:signal')).toBe(2);
      expect(getInitialStabilityForSubtype('custom:lesson')).toBe(90);
      expect(getInitialStabilityForSubtype('custom:playbook')).toBe(180);
    });

    it('falls back to section default for unmapped subtypes', () => {
      expect(getInitialStabilityForSubtype('custom:unknown')).toBe(60); // KNOWLEDGE default
    });

    it('falls back to section default for null', () => {
      expect(getInitialStabilityForSubtype(null)).toBe(60); // KNOWLEDGE default
    });
  });

  describe('SUBTYPE_INITIAL_STABILITY', () => {
    it('covers all subtypes in SUBTYPE_TO_SECTION', () => {
      for (const subtype of Object.keys(SUBTYPE_TO_SECTION)) {
        expect(SUBTYPE_INITIAL_STABILITY[subtype]).toBeDefined();
      }
    });

    it('has 15 entries', () => {
      expect(Object.keys(SUBTYPE_INITIAL_STABILITY)).toHaveLength(15);
    });
  });
});
