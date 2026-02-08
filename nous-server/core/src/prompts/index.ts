/**
 * @module @nous/core/prompts
 * @description Nous Prompt Library (NPL) — 13 production-ready prompts for all LLM operations
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-027
 * @storm Brainstorms/Infrastructure/storm-027-prompt-engineering
 *
 * Modules:
 * - constants: Prompt IDs, cache strategies, model recommendations, token budgets
 * - types: Output schemas with Zod validation, utility functions
 * - intent-detection: IDS v1.0 — fast-path, thresholds, routing
 * - classification: P-001, P-002, P-002C prompts
 * - extraction: P-003, P-004 prompts
 * - cognition: P-005, P-006, P-007 prompts
 * - chat-system: P-008 v2.0 (13-section system prompt)
 * - operations: P-009, P-010, P-010B, P-011 prompts
 * - prompt-registry: Prompt lookup, cache content provider
 */

// ============================================================
// CONSTANTS
// ============================================================

export * from './constants';

// ============================================================
// TYPES AND SCHEMAS
// ============================================================

export * from './types';

// ============================================================
// INTENT DETECTION (IDS v1.0)
// ============================================================

export * from './intent-detection';

// ============================================================
// CLASSIFICATION PROMPTS (P-001, P-002, P-002C)
// ============================================================

export * from './classification';

// ============================================================
// EXTRACTION PROMPTS (P-003, P-004)
// ============================================================

export * from './extraction';

// ============================================================
// COGNITION PROMPTS (P-005, P-006, P-007)
// ============================================================

export * from './cognition';

// ============================================================
// CHAT SYSTEM PROMPT (P-008 v2.0)
// ============================================================

export * from './chat-system';

// ============================================================
// OPERATIONS PROMPTS (P-009, P-010, P-010B, P-011)
// ============================================================

export * from './operations';

// ============================================================
// PROMPT REGISTRY
// ============================================================

export * from './prompt-registry';
