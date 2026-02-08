/**
 * @module @nous/core/agent
 * @description All interfaces and Zod schemas for NEAS (Nous Embedded Agent System)
 * @version 1.0.0
 * @spec Specs/Phase-9-Agent-Tools/storm-019
 * @storm Brainstorms/Infrastructure/storm-019-embedded-ai-agent
 *
 * Defines types for: agent errors, intent assessment, configuration,
 * permissions, sessions, offline behavior, and proactive suggestions.
 */

import { z } from 'zod';
import {
  NeasErrorTypeSchema,
  NeasCertaintyLevelSchema,
  NeasImpactLevelSchema,
  NeasClarificationActionSchema,
  NeasResponseVerbositySchema,
  NeasUncertaintyResponseSchema,
  NeasSearchScopeSchema,
  NeasSuggestionModeSchema,
  NeasPermissionTierSchema,
  type NeasErrorType,
  type NeasCertaintyLevel,
  type NeasImpactLevel,
  type NeasClarificationAction,
  type NeasResponseVerbosity,
  type NeasUncertaintyResponse,
  type NeasSearchScope,
  type NeasSuggestionMode,
  type NeasPermissionTier,
  type AtssToolName,
  type AtssConfirmationLevel,
} from './constants';
import { AtssToolNameSchema, AtssConfirmationLevelSchema } from '../agent-tools/constants';

// ============================================================
// ERROR TYPES
// ============================================================

/** Represents a single agent tool invocation. Used in error tracking and session logging. */
export interface NeasToolCall {
  /** ATSS tool name (e.g., 'create_node', 'search') */
  tool: AtssToolName;
  /** Tool parameters as passed to ATSS */
  params: Record<string, unknown>;
}

export const NeasToolCallSchema = z.object({
  tool: AtssToolNameSchema,
  params: z.record(z.unknown()),
});

/** Structured error from agent error handling flow. */
export interface NeasAgentError {
  /** High-level error classification */
  type: NeasErrorType;
  /** Human-readable error message */
  message: string;
  /** The tool call that caused the error */
  original_action: NeasToolCall;
  /** Original ATSS error code (e.g., 'E404_NODE_NOT_FOUND') */
  atss_error_code: string;
  /** Whether automatic recovery was attempted */
  recovery_attempted: boolean;
  /** Result of recovery attempt (if attempted) */
  recovery_result?: 'success' | 'failed';
}

export const NeasAgentErrorSchema = z.object({
  type: NeasErrorTypeSchema,
  message: z.string(),
  original_action: NeasToolCallSchema,
  atss_error_code: z.string(),
  recovery_attempted: z.boolean(),
  recovery_result: z.enum(['success', 'failed']).optional(),
});

/** User-facing error explanation with recovery suggestion. */
export interface NeasErrorExplanation {
  /** User-friendly error message */
  user_message: string;
  /** Recovery suggestion for the user */
  suggestion: string;
  /** The original agent error */
  original_error: NeasAgentError;
}

export const NeasErrorExplanationSchema = z.object({
  user_message: z.string(),
  suggestion: z.string(),
  original_error: NeasAgentErrorSchema,
});

// ============================================================
// INTENT ASSESSMENT TYPES
// ============================================================

/** Inputs to certainty assessment. Used to determine confidence about user intent. */
export interface NeasCertaintyFactors {
  /** User specified a specific target ("this note" vs "my notes") */
  has_specific_target: boolean;
  /** User specified a clear action ("delete" vs "help with") */
  has_clear_action: boolean;
  /** Request matches a pattern the user has done before */
  matches_prior_pattern: boolean;
  /** Scope is unambiguous ("these 3" vs "some") */
  unambiguous_scope: boolean;
}

export const NeasCertaintyFactorsSchema = z.object({
  has_specific_target: z.boolean(),
  has_clear_action: z.boolean(),
  matches_prior_pattern: z.boolean(),
  unambiguous_scope: z.boolean(),
});

/** Inputs to impact assessment. Used to determine operation impact level. */
export interface NeasImpactFactors {
  /** Operation is destructive (delete, remove, merge) */
  is_destructive: boolean;
  /** Operation affects many items ("all my notes") */
  affects_many: boolean;
  /** Operation is reversible (can undo) */
  is_reversible: boolean;
  /** Estimated credit cost of the operation */
  estimated_cost: number;
}

export const NeasImpactFactorsSchema = z.object({
  is_destructive: z.boolean(),
  affects_many: z.boolean(),
  is_reversible: z.boolean(),
  estimated_cost: z.number().min(0),
});

/** Result of certainty × impact assessment. */
export interface NeasIntentAssessment {
  /** How certain the agent is about user intent */
  certainty: NeasCertaintyLevel;
  /** How much impact the action will have */
  impact: NeasImpactLevel;
  /** What the agent should do */
  action: NeasClarificationAction;
}

export const NeasIntentAssessmentSchema = z.object({
  certainty: NeasCertaintyLevelSchema,
  impact: NeasImpactLevelSchema,
  action: NeasClarificationActionSchema,
});

// ============================================================
// AGENT DEFAULTS (PERSISTED — _schemaVersion required)
// ============================================================

/** User-configurable agent behavior settings. Persisted, requires _schemaVersion. */
export interface NeasAgentDefaults {
  /** Schema version for migration safety */
  _schemaVersion: number;
  /** How verbose responses should be */
  response_verbosity: NeasResponseVerbosity;
  /** Whether to show reasoning steps */
  show_reasoning: boolean;
  /** Search for existing content before creating new */
  auto_search_before_action: boolean;
  /** Show related nodes alongside results */
  auto_show_related: boolean;
  /** Suggest new links proactively */
  auto_suggest_links: boolean;
  /** Require confirmation when more than N items are affected */
  confirm_threshold_items: number;
  /** Require confirmation when cost exceeds N credits */
  confirm_threshold_credits: number;
  /** Always require confirmation for destructive operations */
  confirm_destructive: boolean;
  /** What to do when uncertain about user intent */
  uncertainty_response: NeasUncertaintyResponse;
  /** Default search scope */
  default_search_scope: NeasSearchScope;
  /** Default time range for recency queries (days) */
  default_time_range_days: number;
}

export const NeasAgentDefaultsSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  response_verbosity: NeasResponseVerbositySchema,
  show_reasoning: z.boolean(),
  auto_search_before_action: z.boolean(),
  auto_show_related: z.boolean(),
  auto_suggest_links: z.boolean(),
  confirm_threshold_items: z.number().int().min(1),
  confirm_threshold_credits: z.number().int().min(1),
  confirm_destructive: z.boolean(),
  uncertainty_response: NeasUncertaintyResponseSchema,
  default_search_scope: NeasSearchScopeSchema,
  default_time_range_days: z.number().int().min(1).max(365),
});

// ============================================================
// PERMISSION TYPES (PERSISTED — _schemaVersion required)
// ============================================================

/**
 * 3-tier permission model for agent capabilities.
 * Tier 1: Always on (read) — cannot be disabled.
 * Tier 2: On by default (write, auto-operations) — user can disable.
 * Tier 3: Off by default (delete, bulk) — user must enable.
 */
export interface NeasAgentPermissions {
  /** Schema version for migration safety */
  _schemaVersion: number;
  /** Tier 1: Always on — cannot be disabled */
  can_read: true;
  /** Tier 2: On by default — user can disable */
  can_write: boolean;
  /** Tier 2: On by default — user can disable */
  can_auto_operations: boolean;
  /** Tier 3: Off by default — user must enable */
  can_delete: boolean;
  /** Tier 3: Off by default — user must enable */
  can_bulk_operations: boolean;
}

export const NeasAgentPermissionsSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  can_read: z.literal(true),
  can_write: z.boolean(),
  can_auto_operations: z.boolean(),
  can_delete: z.boolean(),
  can_bulk_operations: z.boolean(),
});

// ============================================================
// AGENT LIMITS
// ============================================================

/** Request-level operation caps. Prevents runaway operations and excessive credit spending. */
export interface NeasAgentLimits {
  /** Maximum tool calls per user request */
  max_operations_per_request: number;
  /** Maximum credits per user request */
  max_credits_per_request: number;
  /** Show preview if more than N items affected */
  preview_threshold: number;
  /** Process large operations in batches of N */
  context_batch_size: number;
}

export const NeasAgentLimitsSchema = z.object({
  max_operations_per_request: z.number().int().min(1),
  max_credits_per_request: z.number().int().min(1),
  preview_threshold: z.number().int().min(1),
  context_batch_size: z.number().int().min(1),
});

// ============================================================
// SESSION TYPES (PERSISTED — _schemaVersion required)
// ============================================================

/** Single tracked action in a session. */
export interface NeasSessionAction {
  /** ATSS tool that was executed */
  tool: AtssToolName;
  /** Reference to ATSS undo entry (null for read operations) */
  atss_undo_entry_id: string | null;
  /** When the action was performed (ISO 8601) */
  timestamp: string;
  /** Credit cost of this action */
  credit_cost: number;
}

export const NeasSessionActionSchema = z.object({
  tool: AtssToolNameSchema,
  atss_undo_entry_id: z.string().nullable(),
  timestamp: z.string(),
  credit_cost: z.number().min(0),
});

/** Per-request session tracking. Tracks all operations during a single user request. */
export interface NeasAgentSession {
  /** Schema version for migration safety */
  _schemaVersion: number;
  /** Unique session ID (ses_ + nanoid(12)) */
  id: string;
  /** User who owns this session */
  user_id: string;
  /** When the session started (ISO 8601) */
  started_at: string;
  /** Total number of tool operations performed */
  operations_count: number;
  /** Total credits spent in this session */
  credits_spent: number;
  /** Ordered log of all actions in this session */
  action_log: NeasSessionAction[];
}

export const NeasAgentSessionSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  id: z.string(),
  user_id: z.string(),
  started_at: z.string(),
  operations_count: z.number().int().min(0),
  credits_spent: z.number().min(0),
  action_log: z.array(NeasSessionActionSchema),
});

/** Result of checking whether an operation can proceed. */
export interface NeasOperationCheck {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Reason for denial (if not allowed) */
  reason?: string;
  /** How many more operations can be performed this request */
  remaining_operations: number;
  /** How many more credits can be spent this request */
  remaining_credits: number;
}

export const NeasOperationCheckSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
  remaining_operations: z.number().int(),
  remaining_credits: z.number(),
});

/** Summary stats for a completed session. */
export interface NeasSessionSummary {
  /** Total operations performed */
  total_operations: number;
  /** Total credits spent */
  total_credits: number;
  /** Session duration in milliseconds */
  duration_ms: number;
  /** Count of each tool used (tool name -> count) */
  tools_used: Record<string, number>;
}

export const NeasSessionSummarySchema = z.object({
  total_operations: z.number().int().min(0),
  total_credits: z.number().min(0),
  duration_ms: z.number().min(0),
  tools_used: z.record(z.number().int().min(0)),
});

// ============================================================
// OFFLINE TYPES
// ============================================================

/** Agent capabilities when offline. */
export interface NeasOfflineCapabilities {
  /** Tools that work offline (read-only ATSS tools) */
  available_tools: readonly AtssToolName[];
  /** Whether the agent is in read-only mode */
  read_only: boolean;
  /** Whether previously cached suggestions are accessible */
  cached_suggestions_available: boolean;
}

export const NeasOfflineCapabilitiesSchema = z.object({
  available_tools: z.array(AtssToolNameSchema).readonly(),
  read_only: z.boolean(),
  cached_suggestions_available: z.boolean(),
});

// ============================================================
// SUGGESTION TYPES (PERSISTED — _schemaVersion required)
// ============================================================

/** Proactive suggestion configuration. Controls when and how the agent suggests improvements. */
export interface NeasSuggestionConfig {
  /** Schema version for migration safety */
  _schemaVersion: number;
  /** Suggestion display mode */
  mode: NeasSuggestionMode;
  /** Maximum suggestions per day */
  max_per_day: number;
  /** Minimum confidence threshold (0.0-1.0) */
  min_confidence: number;
  /** Quiet hours start (0-23, hour of day) */
  quiet_hours_start: number;
  /** Quiet hours end (0-23, hour of day) */
  quiet_hours_end: number;
}

export const NeasSuggestionConfigSchema = z.object({
  _schemaVersion: z.number().int().min(1),
  mode: NeasSuggestionModeSchema,
  max_per_day: z.number().int().min(0),
  min_confidence: z.number().min(0).max(1),
  quiet_hours_start: z.number().int().min(0).max(23),
  quiet_hours_end: z.number().int().min(0).max(23),
});

// ============================================================
// COMBINED PERMISSION CHECK RESULT
// ============================================================

/** Result of combined NEAS + ATSS permission check. */
export interface NeasPermissionCheckResult {
  /** Whether the tool call is allowed */
  allowed: boolean;
  /** Reason for denial (if not allowed) */
  denied_reason?: string;
  /** Effective confirmation level after combining NEAS + ATSS rules */
  effective_confirmation: AtssConfirmationLevel;
  /** Which permission tier this tool belongs to */
  permission_tier: NeasPermissionTier;
}

export const NeasPermissionCheckResultSchema = z.object({
  allowed: z.boolean(),
  denied_reason: z.string().optional(),
  effective_confirmation: AtssConfirmationLevelSchema,
  permission_tier: NeasPermissionTierSchema,
});
