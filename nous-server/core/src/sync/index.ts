/**
 * @module @nous/core/sync
 * @description Sync infrastructure for Nous
 * @version 2.0.0
 * @spec Brainstorms/Specs/storm-017, Brainstorms/Specs/Phase-6-Technical-Services/storm-033
 *
 * This module provides:
 * - Sync manager interface and state types (storm-017)
 * - Conflict detection and resolution (storm-017)
 * - Health monitoring (storm-017)
 * - Nous Sync Engine (NSE) v1 - version vectors, change sets,
 *   merge strategies, auto-merge algorithm, private tier sync,
 *   embedding sync, notifications, edge cases (storm-033)
 */

// ── Storm-017: Foundation ──────────────────────────────────

// Sync manager types
export * from './sync-manager';

// Conflict resolution
export * from './conflict-resolution';

// Health monitoring
export * from './health';

// ── Storm-033: Nous Sync Engine (NSE) v1 ───────────────────

// NSE constants (platforms, strategies, thresholds)
export * from './nse-constants';

// NSE types and Zod schemas
export * from './nse-types';

// NSE engine functions (version vectors, merge, auto-merge, etc.)
export * from './nse-engine';
