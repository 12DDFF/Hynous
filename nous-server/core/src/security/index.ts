/**
 * @module @nous/core/security
 * @description Nous Security Layer (NSL) - Authentication, encryption, privacy tiers
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * Two-tier privacy model (Standard vs Private), Clerk authentication,
 * E2E encryption (Private tier), key hierarchy, key rotation,
 * BIP39 recovery, LLM consent UX, BYOK API keys, export compliance,
 * and offline auth state management.
 *
 * Module structure:
 * - constants: Enums, thresholds, crypto parameters, type guards
 * - types: Interfaces and Zod schemas for all security domains
 * - auth: Clerk config, platform auth, token validation, offline transitions
 * - tiers: Privacy tier definitions, comparison, tier migration
 * - encryption: E2E encryption schema, field maps, client-side search
 * - keys: Key hierarchy, derivation, multi-device sync, key rotation
 * - recovery: BIP39 recovery codes, verification, grace period
 * - consent: LLM consent UX, topic matching, decline handling
 * - api-keys: Platform keys, BYOK encryption, rate limiting
 * - compliance: Export compliance, threat model, launch strategy
 * - offline: Offline auth states, sync queue, capability checks
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/Index} - Spec overview
 */

// ============================================================
// RE-EXPORTS: CONSTANTS & TYPES
// ============================================================

// Constants (enums, type guards, numeric thresholds, crypto params)
export * from './constants';

// Types (interfaces, Zod schemas)
export * from './types';

// ============================================================
// RE-EXPORTS: DOMAIN MODULES
// ============================================================

// Authentication (Clerk, platform auth, token validation)
export * from './auth';

// Privacy tiers (definitions, comparison, migration)
export * from './tiers';

// Encryption (E2E encryption, field maps, client-side search)
export * from './encryption';

// Key hierarchy & rotation (derivation, multi-device, rotation lifecycle)
export * from './keys';

// Recovery (BIP39, forced verification, grace period)
export * from './recovery';

// LLM consent (consent state, topic matching, decline handling)
export * from './consent';

// API key security (platform keys, BYOK, rate limiting)
export * from './api-keys';

// Export compliance (threat model, regional compliance, launch strategy)
export * from './compliance';

// Offline auth (5 states, sync queue, capability checks)
export * from './offline';
