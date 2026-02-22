/**
 * Tests for per-section decay curve functions (Issue 2).
 *
 * Tests the new section-aware variants: getDecayLifecycleStateForSection()
 * and updateStabilityOnAccessForSection().
 */
import { describe, it, expect } from 'vitest';
import {
  calculateRetrievability,
  getDecayLifecycleState,
  getDecayLifecycleStateForSection,
  updateStabilityOnAccess,
  updateStabilityOnAccessForSection,
  DECAY_CONFIG,
} from './index.js';
import {
  SECTION_PROFILES,
  SUBTYPE_INITIAL_STABILITY,
  getInitialStabilityForSubtype,
  getSectionForSubtype,
  type SectionDecayConfig,
} from '../sections/index.js';

// ============================================================
// getDecayLifecycleStateForSection
// ============================================================

describe('getDecayLifecycleStateForSection', () => {
  describe('basic lifecycle transitions', () => {
    const knowledgeDecay = SECTION_PROFILES.KNOWLEDGE.decay;

    it('returns ACTIVE for high retrievability', () => {
      expect(getDecayLifecycleStateForSection(0.8, 0, knowledgeDecay)).toBe('ACTIVE');
    });

    it('returns WEAK for medium retrievability', () => {
      expect(getDecayLifecycleStateForSection(0.2, 0, knowledgeDecay)).toBe('WEAK');
    });

    it('returns DORMANT for low retrievability with few dormant days', () => {
      expect(getDecayLifecycleStateForSection(0.01, 30, knowledgeDecay)).toBe('DORMANT');
    });

    it('returns COMPRESS for extended dormancy', () => {
      // dormant_days=60, compress_days=120 (from global DECAY_CONFIG)
      expect(getDecayLifecycleStateForSection(0.01, 90, knowledgeDecay)).toBe('COMPRESS');
    });

    it('returns ARCHIVE for very long dormancy', () => {
      expect(getDecayLifecycleStateForSection(0.01, 250, knowledgeDecay)).toBe('ARCHIVE');
    });
  });

  describe('per-section threshold differences', () => {
    it('KNOWLEDGE stays ACTIVE at lower R than SIGNALS', () => {
      const knowledgeDecay = SECTION_PROFILES.KNOWLEDGE.decay;  // active_threshold: 0.4
      const signalsDecay = SECTION_PROFILES.SIGNALS.decay;      // active_threshold: 0.5

      // R = 0.45 — ACTIVE for KNOWLEDGE, WEAK for SIGNALS
      expect(getDecayLifecycleStateForSection(0.45, 0, knowledgeDecay)).toBe('ACTIVE');
      expect(getDecayLifecycleStateForSection(0.45, 0, signalsDecay)).toBe('WEAK');
    });

    it('PROCEDURAL stays ACTIVE at even lower R', () => {
      const proceduralDecay = SECTION_PROFILES.PROCEDURAL.decay;  // active_threshold: 0.3

      // R = 0.35 — still ACTIVE for PROCEDURAL
      expect(getDecayLifecycleStateForSection(0.35, 0, proceduralDecay)).toBe('ACTIVE');
    });

    it('SIGNALS enters WEAK at higher R than others', () => {
      const signalsDecay = SECTION_PROFILES.SIGNALS.decay;        // weak_threshold: 0.15
      const knowledgeDecay = SECTION_PROFILES.KNOWLEDGE.decay;    // weak_threshold: 0.05

      // R = 0.12 — DORMANT for SIGNALS (< 0.15), still WEAK for KNOWLEDGE (> 0.05)
      expect(getDecayLifecycleStateForSection(0.12, 0, signalsDecay)).toBe('DORMANT');
      expect(getDecayLifecycleStateForSection(0.12, 0, knowledgeDecay)).toBe('WEAK');
    });

    it('PROCEDURAL resists DORMANT with very low weak_threshold', () => {
      const proceduralDecay = SECTION_PROFILES.PROCEDURAL.decay;  // weak_threshold: 0.03

      // R = 0.04 — still WEAK for PROCEDURAL (> 0.03)
      expect(getDecayLifecycleStateForSection(0.04, 0, proceduralDecay)).toBe('WEAK');
    });
  });

  describe('fixes dead branch bug from original', () => {
    it('returns COMPRESS (not DORMANT) for days between dormant_days and compress_days', () => {
      const decay = SECTION_PROFILES.KNOWLEDGE.decay;

      // daysDormant = 90, which is > dormant_days (60) and < compress_days (120)
      // Original function had dead branch: returned 'DORMANT' here
      // New function correctly returns 'COMPRESS'
      expect(getDecayLifecycleStateForSection(0.01, 90, decay)).toBe('COMPRESS');
    });

    it('original function has dead branch (returns DORMANT instead of COMPRESS)', () => {
      // This documents the known bug in the original function
      // daysDormant = 90: > dormant_days (60), < compress_days (120)
      // Line 1029: 90 < 60? No, skip
      // Line 1030: 90 < 120? Yes, return 'DORMANT' — BUG (should be 'COMPRESS')
      const originalResult = getDecayLifecycleState(0.05, 90);
      // The original returns 'DORMANT' here, but the correct answer is 'COMPRESS'
      expect(originalResult).toBe('DORMANT');  // Documenting the bug

      // The new function returns the correct state
      const fixedResult = getDecayLifecycleStateForSection(0.05, 90, SECTION_PROFILES.KNOWLEDGE.decay);
      expect(fixedResult).toBe('COMPRESS');    // Fixed
    });
  });

  describe('all four sections have valid decay configs', () => {
    for (const [section, profile] of Object.entries(SECTION_PROFILES)) {
      it(`${section} has valid thresholds (weak < active)`, () => {
        expect(profile.decay.weak_threshold).toBeLessThan(profile.decay.active_threshold);
      });

      it(`${section} transitions correctly through all states`, () => {
        const d = profile.decay;
        expect(getDecayLifecycleStateForSection(d.active_threshold + 0.1, 0, d)).toBe('ACTIVE');
        expect(getDecayLifecycleStateForSection((d.active_threshold + d.weak_threshold) / 2, 0, d)).toBe('WEAK');
        expect(getDecayLifecycleStateForSection(d.weak_threshold - 0.01, 30, d)).toBe('DORMANT');
        expect(getDecayLifecycleStateForSection(d.weak_threshold - 0.01, 90, d)).toBe('COMPRESS');
        expect(getDecayLifecycleStateForSection(d.weak_threshold - 0.01, 250, d)).toBe('ARCHIVE');
      });
    }
  });
});

// ============================================================
// updateStabilityOnAccessForSection
// ============================================================

describe('updateStabilityOnAccessForSection', () => {
  describe('basic growth behavior', () => {
    it('increases stability on access', () => {
      const decay = SECTION_PROFILES.KNOWLEDGE.decay;
      const newStability = updateStabilityOnAccessForSection(10, 0.3, decay);
      expect(newStability).toBeGreaterThan(10);
    });

    it('caps at section max_stability_days', () => {
      const decay = SECTION_PROFILES.SIGNALS.decay;  // max_stability_days: 30
      const newStability = updateStabilityOnAccessForSection(25, 0.1, decay);
      expect(newStability).toBeLessThanOrEqual(30);
    });

    it('grows less with higher difficulty', () => {
      const decay = SECTION_PROFILES.KNOWLEDGE.decay;
      const lowDiff = updateStabilityOnAccessForSection(10, 0.1, decay);
      const highDiff = updateStabilityOnAccessForSection(10, 0.9, decay);
      expect(lowDiff).toBeGreaterThan(highDiff);
    });
  });

  describe('per-section growth rates', () => {
    it('PROCEDURAL grows fastest (3.5)', () => {
      const stability = 10;
      const difficulty = 0.3;
      const procedural = updateStabilityOnAccessForSection(stability, difficulty, SECTION_PROFILES.PROCEDURAL.decay);
      const knowledge = updateStabilityOnAccessForSection(stability, difficulty, SECTION_PROFILES.KNOWLEDGE.decay);
      const episodic = updateStabilityOnAccessForSection(stability, difficulty, SECTION_PROFILES.EPISODIC.decay);
      const signals = updateStabilityOnAccessForSection(stability, difficulty, SECTION_PROFILES.SIGNALS.decay);

      expect(procedural).toBeGreaterThan(knowledge);
      expect(knowledge).toBeGreaterThan(episodic);
      expect(episodic).toBeGreaterThan(signals);
    });

    it('SIGNALS growth is limited by max_stability_days: 30', () => {
      const signalDecay = SECTION_PROFILES.SIGNALS.decay;
      // Even with high base stability, cannot exceed 30 days
      const newStability = updateStabilityOnAccessForSection(20, 0.1, signalDecay);
      expect(newStability).toBeLessThanOrEqual(30);
    });

    it('KNOWLEDGE can reach 365 days', () => {
      const knowledgeDecay = SECTION_PROFILES.KNOWLEDGE.decay;
      // With high enough starting stability, can approach 365
      const newStability = updateStabilityOnAccessForSection(200, 0.1, knowledgeDecay);
      expect(newStability).toBeLessThanOrEqual(365);
      expect(newStability).toBeGreaterThan(200);
    });
  });

  describe('matches original function for global config', () => {
    // When given the global DECAY_CONFIG values, the section function
    // should produce the same result as the original
    const globalDecay: SectionDecayConfig = {
      initial_stability_days: 21,
      growth_rate: DECAY_CONFIG.growth_rate,          // 2.5
      active_threshold: DECAY_CONFIG.active_threshold, // 0.5
      weak_threshold: DECAY_CONFIG.weak_threshold,     // 0.1
      max_stability_days: DECAY_CONFIG.max_stability_days, // 365
    };

    it('produces identical results when using global params', () => {
      const original = updateStabilityOnAccess(10, 0.3);
      const section = updateStabilityOnAccessForSection(10, 0.3, globalDecay);
      expect(section).toBeCloseTo(original, 6);
    });
  });
});

// ============================================================
// getInitialStabilityForSubtype
// ============================================================

describe('getInitialStabilityForSubtype', () => {
  describe('per-subtype overrides', () => {
    it('signal: 2 days (fast decay)', () => {
      expect(getInitialStabilityForSubtype('custom:signal')).toBe(2);
    });

    it('lesson: 90 days (very durable)', () => {
      expect(getInitialStabilityForSubtype('custom:lesson')).toBe(90);
    });

    it('playbook: 180 days (nearly permanent)', () => {
      expect(getInitialStabilityForSubtype('custom:playbook')).toBe(180);
    });

    it('trade_entry: 21 days', () => {
      expect(getInitialStabilityForSubtype('custom:trade_entry')).toBe(21);
    });

    it('trade_close: 21 days', () => {
      expect(getInitialStabilityForSubtype('custom:trade_close')).toBe(21);
    });

    it('turn_summary: 7 days (fast decay)', () => {
      expect(getInitialStabilityForSubtype('custom:turn_summary')).toBe(7);
    });

    it('watchpoint: 5 days', () => {
      expect(getInitialStabilityForSubtype('custom:watchpoint')).toBe(5);
    });

    it('thesis: 30 days', () => {
      expect(getInitialStabilityForSubtype('custom:thesis')).toBe(30);
    });

    it('curiosity: 14 days', () => {
      expect(getInitialStabilityForSubtype('custom:curiosity')).toBe(14);
    });
  });

  describe('section fallbacks', () => {
    it('unknown subtype falls back to KNOWLEDGE default (60 days)', () => {
      expect(getInitialStabilityForSubtype('custom:future_type')).toBe(60);
    });

    it('null subtype falls back to KNOWLEDGE default (60 days)', () => {
      expect(getInitialStabilityForSubtype(null)).toBe(60);
    });

    it('undefined subtype falls back to KNOWLEDGE default (60 days)', () => {
      expect(getInitialStabilityForSubtype(undefined)).toBe(60);
    });
  });

  describe('ordering invariants', () => {
    it('signals decay fastest', () => {
      const signal = getInitialStabilityForSubtype('custom:signal');
      for (const subtype of Object.keys(SUBTYPE_INITIAL_STABILITY)) {
        if (subtype !== 'custom:signal') {
          expect(signal).toBeLessThanOrEqual(getInitialStabilityForSubtype(subtype));
        }
      }
    });

    it('playbooks are most durable', () => {
      const playbook = getInitialStabilityForSubtype('custom:playbook');
      for (const subtype of Object.keys(SUBTYPE_INITIAL_STABILITY)) {
        expect(playbook).toBeGreaterThanOrEqual(getInitialStabilityForSubtype(subtype));
      }
    });
  });
});

// ============================================================
// Integration: calculateRetrievability with section stability
// ============================================================

describe('FSRS decay with section-aware stability', () => {
  it('signal (2d stability) decays much faster than lesson (90d stability)', () => {
    const daysElapsed = 5;
    const signalR = calculateRetrievability(daysElapsed, 2);   // R = e^(-5/2) ≈ 0.082
    const lessonR = calculateRetrievability(daysElapsed, 90);  // R = e^(-5/90) ≈ 0.946

    expect(signalR).toBeLessThan(0.1);   // Signal nearly forgotten after 5 days
    expect(lessonR).toBeGreaterThan(0.9); // Lesson barely faded after 5 days
  });

  it('playbook (180d stability) barely decays after a month', () => {
    const daysElapsed = 30;
    const playbookR = calculateRetrievability(daysElapsed, 180); // R = e^(-30/180) ≈ 0.846
    expect(playbookR).toBeGreaterThan(0.8);
  });

  it('signal enters DORMANT lifecycle before lesson enters WEAK', () => {
    const signalDecay = SECTION_PROFILES.SIGNALS.decay;
    const knowledgeDecay = SECTION_PROFILES.KNOWLEDGE.decay;

    // After 7 days, signal (stability 2d) is nearly forgotten
    const signalR = calculateRetrievability(7, 2);   // R ≈ 0.030
    const signalState = getDecayLifecycleStateForSection(signalR, 7, signalDecay);

    // After 7 days, lesson (stability 90d) is barely faded
    const lessonR = calculateRetrievability(7, 90);   // R ≈ 0.925
    const lessonState = getDecayLifecycleStateForSection(lessonR, 0, knowledgeDecay);

    expect(signalState).toBe('DORMANT');  // Signal is dormant after a week
    expect(lessonState).toBe('ACTIVE');   // Lesson is still active after a week
  });

  it('signal cannot exceed 30-day stability even with repeated access', () => {
    const signalDecay = SECTION_PROFILES.SIGNALS.decay;
    let stability = 2;  // Start with initial signal stability

    // Simulate 10 recall events
    for (let i = 0; i < 10; i++) {
      stability = updateStabilityOnAccessForSection(stability, 0.2, signalDecay);
    }

    // Should be capped at 30 days regardless
    expect(stability).toBeLessThanOrEqual(30);
  });

  it('lesson grows to high stability with repeated access', () => {
    const knowledgeDecay = SECTION_PROFILES.KNOWLEDGE.decay;
    let stability = 90;  // Start with initial lesson stability

    // Simulate 3 recall events
    for (let i = 0; i < 3; i++) {
      stability = updateStabilityOnAccessForSection(stability, 0.4, knowledgeDecay);
    }

    // Should have grown significantly (but capped at 365)
    expect(stability).toBeGreaterThan(200);
    expect(stability).toBeLessThanOrEqual(365);
  });
});
