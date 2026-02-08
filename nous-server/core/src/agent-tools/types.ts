/**
 * @module @nous/core/agent-tools
 * @description All interfaces and Zod schemas for ATSS (Agent Tool Specification System)
 * @version 1.0.0
 * @spec Specs/Phase-9-Agent-Tools/storm-030
 * @storm Brainstorms/Infrastructure/storm-030-agent-tool-specs
 *
 * Consolidates types from spec files: tool-schemas, undo-system,
 * permission-confirmation, safety-circuit-breaker, error-responses.
 */

import { z } from 'zod';
import {
  NODE_TYPES,
  EDGE_TYPES,
  LIFECYCLE_STATES,
  type NodeType,
  type EdgeType,
  type LifecycleState,
} from '../constants';
import {
  type AtssToolName,
  type AtssToolCategory,
  type AtssConfirmationLevel,
  type AtssBulkMode,
  type AtssUndoStatus,
  type AtssCircuitBreakerState,
  type AtssTier,
  AtssToolNameSchema,
  AtssConfirmationLevelSchema,
  AtssBulkModeSchema,
  AtssUndoStatusSchema,
  AtssCircuitBreakerStateSchema,
  AtssTierSchema,
  ATSS_MAX_NODE_IDS_PER_VIEW,
  ATSS_MAX_SEARCH_LIMIT,
  ATSS_DEFAULT_SEARCH_LIMIT,
  ATSS_MAX_CONTENT_LENGTH,
  ATSS_DEFAULT_MAX_CONTENT_LENGTH,
  ATSS_MAX_TAGS,
  ATSS_MAX_BULK_OPERATIONS,
  ATSS_DEFAULT_MIN_SEARCH_SCORE,
} from './constants';

// ============================================================
// COMMON TYPES
// ============================================================

/** Lightweight node summary for compact representations. */
export interface AtssNodeSummary {
  node_id: string;
  title: string;
  type: NodeType;
  cluster?: string;
}

export const AtssNodeSummarySchema = z.object({
  node_id: z.string(),
  title: z.string(),
  type: z.enum(NODE_TYPES),
  cluster: z.string().optional(),
});

export const ATSS_CONNECTION_DIRECTIONS = ['outgoing', 'incoming'] as const;
export type AtssConnectionDirection = (typeof ATSS_CONNECTION_DIRECTIONS)[number];

// ============================================================
// VIEW_NODE TOOL TYPES
// ============================================================

export interface AtssViewNodeParams {
  node_ids: string[];
  include_metadata?: boolean;
  include_connections?: boolean;
  max_content_length?: number;
  include_deleted?: boolean;
}

export const AtssViewNodeParamsSchema = z.object({
  node_ids: z.array(z.string()).min(1).max(ATSS_MAX_NODE_IDS_PER_VIEW),
  include_metadata: z.boolean().default(false),
  include_connections: z.boolean().default(false),
  max_content_length: z.number().int().min(1).max(ATSS_MAX_CONTENT_LENGTH).default(ATSS_DEFAULT_MAX_CONTENT_LENGTH),
  include_deleted: z.boolean().default(false),
});

export interface AtssNodeMetadata {
  stability: number;
  retrievability: number;
  access_count: number;
  lifecycle_state: LifecycleState;
}

export const AtssNodeMetadataSchema = z.object({
  stability: z.number().min(0).max(1),
  retrievability: z.number().min(0).max(1),
  access_count: z.number().int().min(0),
  lifecycle_state: z.enum(LIFECYCLE_STATES),
});

export interface AtssNodeConnection {
  edge_id: string;
  target_id: string;
  target_title: string;
  relation_type: EdgeType;
  weight: number;
  direction: AtssConnectionDirection;
}

export const AtssNodeConnectionSchema = z.object({
  edge_id: z.string(),
  target_id: z.string(),
  target_title: z.string(),
  relation_type: z.enum(EDGE_TYPES),
  weight: z.number().min(0).max(1),
  direction: z.enum(ATSS_CONNECTION_DIRECTIONS),
});

export interface AtssViewedNode {
  node_id: string;
  title: string;
  type: NodeType;
  content: string;
  tags: string[];
  cluster?: string;
  created_at: string;
  updated_at: string;
  metadata?: AtssNodeMetadata;
  connections?: AtssNodeConnection[];
}

export const AtssViewedNodeSchema = z.object({
  node_id: z.string(),
  title: z.string(),
  type: z.enum(NODE_TYPES),
  content: z.string(),
  tags: z.array(z.string()),
  cluster: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  metadata: AtssNodeMetadataSchema.optional(),
  connections: z.array(AtssNodeConnectionSchema).optional(),
});

export interface AtssViewNodeResult {
  success: boolean;
  nodes: AtssViewedNode[];
  not_found: string[];
  truncated_count: number;
}

export const AtssViewNodeResultSchema = z.object({
  success: z.boolean(),
  nodes: z.array(AtssViewedNodeSchema),
  not_found: z.array(z.string()),
  truncated_count: z.number().int().min(0),
});

// ============================================================
// SEARCH TOOL TYPES
// ============================================================

export interface AtssSearchFilters {
  types?: NodeType[];
  clusters?: string[];
  tags?: string[];
  date_range?: { start?: string; end?: string };
}

export const AtssSearchFiltersSchema = z.object({
  types: z.array(z.enum(NODE_TYPES)).optional(),
  clusters: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  date_range: z.object({
    start: z.string().datetime().optional(),
    end: z.string().datetime().optional(),
  }).optional(),
});

export interface AtssSearchParams {
  query: string;
  filters?: AtssSearchFilters;
  limit?: number;
  include_similar?: boolean;
  min_score?: number;
}

export const AtssSearchParamsSchema = z.object({
  query: z.string().min(1),
  filters: AtssSearchFiltersSchema.optional(),
  limit: z.number().int().min(1).max(ATSS_MAX_SEARCH_LIMIT).default(ATSS_DEFAULT_SEARCH_LIMIT),
  include_similar: z.boolean().default(false),
  min_score: z.number().min(0).max(1).default(ATSS_DEFAULT_MIN_SEARCH_SCORE),
});

export interface AtssSearchResultItem {
  node_id: string;
  title: string;
  snippet: string;
  score: number;
  type: NodeType;
  cluster?: string;
  tags: string[];
  last_accessed?: string;
}

export const AtssSearchResultItemSchema = z.object({
  node_id: z.string(),
  title: z.string(),
  snippet: z.string(),
  score: z.number().min(0).max(1),
  type: z.enum(NODE_TYPES),
  cluster: z.string().optional(),
  tags: z.array(z.string()),
  last_accessed: z.string().datetime().optional(),
});

export interface AtssSearchResult {
  success: boolean;
  results: AtssSearchResultItem[];
  total_count: number;
  has_more: boolean;
  query_interpretation?: string;
}

export const AtssSearchResultSchema = z.object({
  success: z.boolean(),
  results: z.array(AtssSearchResultItemSchema),
  total_count: z.number().int().min(0),
  has_more: z.boolean(),
  query_interpretation: z.string().optional(),
});

// ============================================================
// CREATE_NODE TOOL TYPES
// ============================================================

export interface AtssCreateNodeParams {
  type: NodeType;
  title: string;
  content: string;
  tags?: string[];
  cluster_id?: string;
  source?: string;
  dry_run?: boolean;
}

export const AtssCreateNodeParamsSchema = z.object({
  type: z.enum(NODE_TYPES),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(ATSS_MAX_CONTENT_LENGTH),
  tags: z.array(z.string()).max(ATSS_MAX_TAGS).default([]),
  cluster_id: z.string().optional(),
  source: z.string().optional(),
  dry_run: z.boolean().default(false),
});

export interface AtssCreateNodeResult {
  success: boolean;
  node_id: string;
  created_at: string;
  cluster_assigned?: string;
  similar_nodes: AtssNodeSummary[];
  dry_run: boolean;
  undo_entry_id?: string;
}

export const AtssCreateNodeResultSchema = z.object({
  success: z.boolean(),
  node_id: z.string(),
  created_at: z.string().datetime(),
  cluster_assigned: z.string().optional(),
  similar_nodes: z.array(AtssNodeSummarySchema),
  dry_run: z.boolean(),
  undo_entry_id: z.string().optional(),
});

// ============================================================
// UPDATE_NODE TOOL TYPES
// ============================================================

export interface AtssNodeChanges {
  title?: string;
  content?: string;
  tags?: string[];
  cluster_id?: string;
  type?: NodeType;
}

export const AtssNodeChangesSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(ATSS_MAX_CONTENT_LENGTH).optional(),
  tags: z.array(z.string()).max(ATSS_MAX_TAGS).optional(),
  cluster_id: z.string().optional(),
  type: z.enum(NODE_TYPES).optional(),
}).refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: 'At least one change field must be specified' }
);

export interface AtssUpdateNodeParams {
  node_id: string;
  changes: AtssNodeChanges;
  confidence?: number;
  dry_run?: boolean;
}

export const AtssUpdateNodeParamsSchema = z.object({
  node_id: z.string(),
  changes: AtssNodeChangesSchema,
  confidence: z.number().min(0).max(1).default(1.0),
  dry_run: z.boolean().default(false),
});

export interface AtssUpdateNodeResult {
  success: boolean;
  node_id: string;
  updated_fields: string[];
  previous_values: Record<string, unknown>;
  updated_at: string;
  dry_run: boolean;
  undo_entry_id?: string;
}

export const AtssUpdateNodeResultSchema = z.object({
  success: z.boolean(),
  node_id: z.string(),
  updated_fields: z.array(z.string()),
  previous_values: z.record(z.unknown()),
  updated_at: z.string().datetime(),
  dry_run: z.boolean(),
  undo_entry_id: z.string().optional(),
});

// ============================================================
// DELETE_NODE TOOL TYPES
// ============================================================

export interface AtssDeleteNodeParams {
  node_id: string;
  reason?: string;
  cascade_edges?: boolean;
  dry_run?: boolean;
}

export const AtssDeleteNodeParamsSchema = z.object({
  node_id: z.string(),
  reason: z.string().optional(),
  cascade_edges: z.boolean().default(true),
  dry_run: z.boolean().default(false),
});

export interface AtssDeleteNodeResult {
  success: boolean;
  node_id: string;
  node_title: string;
  deleted_at: string;
  restore_deadline: string;
  edges_affected: number;
  edge_ids_affected: string[];
  dry_run: boolean;
  undo_entry_id?: string;
}

export const AtssDeleteNodeResultSchema = z.object({
  success: z.boolean(),
  node_id: z.string(),
  node_title: z.string(),
  deleted_at: z.string().datetime(),
  restore_deadline: z.string().datetime(),
  edges_affected: z.number().int().min(0),
  edge_ids_affected: z.array(z.string()),
  dry_run: z.boolean(),
  undo_entry_id: z.string().optional(),
});

// ============================================================
// CREATE_EDGE TOOL TYPES
// ============================================================

export interface AtssCreateEdgeParams {
  source_id: string;
  target_id: string;
  relation_type: EdgeType;
  weight?: number;
  bidirectional?: boolean;
  dry_run?: boolean;
}

export const AtssCreateEdgeParamsSchema = z.object({
  source_id: z.string(),
  target_id: z.string(),
  relation_type: z.enum(EDGE_TYPES),
  weight: z.number().min(0).max(1).default(0.5),
  bidirectional: z.boolean().default(false),
  dry_run: z.boolean().default(false),
}).refine(
  (data) => data.source_id !== data.target_id,
  { message: 'Cannot create edge from node to itself', path: ['target_id'] }
);

export interface AtssCreateEdgeResult {
  success: boolean;
  edge_id: string;
  reverse_edge_id?: string;
  source_title: string;
  target_title: string;
  created_at: string;
  dry_run: boolean;
  undo_entry_id?: string;
}

export const AtssCreateEdgeResultSchema = z.object({
  success: z.boolean(),
  edge_id: z.string(),
  reverse_edge_id: z.string().optional(),
  source_title: z.string(),
  target_title: z.string(),
  created_at: z.string().datetime(),
  dry_run: z.boolean(),
  undo_entry_id: z.string().optional(),
});

// ============================================================
// DELETE_EDGE TOOL TYPES
// ============================================================

export interface AtssDeleteEdgeParams {
  edge_id: string;
  dry_run?: boolean;
}

export const AtssDeleteEdgeParamsSchema = z.object({
  edge_id: z.string(),
  dry_run: z.boolean().default(false),
});

export interface AtssDeleteEdgeResult {
  success: boolean;
  edge_id: string;
  source_title: string;
  target_title: string;
  relation_type: EdgeType;
  deleted_at: string;
  dry_run: boolean;
  undo_entry_id?: string;
}

export const AtssDeleteEdgeResultSchema = z.object({
  success: z.boolean(),
  edge_id: z.string(),
  source_title: z.string(),
  target_title: z.string(),
  relation_type: z.enum(EDGE_TYPES),
  deleted_at: z.string().datetime(),
  dry_run: z.boolean(),
  undo_entry_id: z.string().optional(),
});

// ============================================================
// LINK_TO_CLUSTER TOOL TYPES
// ============================================================

export interface AtssLinkToClusterParams {
  node_id: string;
  cluster_id: string;
  create_if_missing?: boolean;
  dry_run?: boolean;
}

export const AtssLinkToClusterParamsSchema = z.object({
  node_id: z.string(),
  cluster_id: z.string(),
  create_if_missing: z.boolean().default(false),
  dry_run: z.boolean().default(false),
});

export interface AtssLinkToClusterResult {
  success: boolean;
  node_id: string;
  node_title: string;
  previous_cluster?: string;
  new_cluster: string;
  cluster_created: boolean;
  dry_run: boolean;
  undo_entry_id?: string;
}

export const AtssLinkToClusterResultSchema = z.object({
  success: z.boolean(),
  node_id: z.string(),
  node_title: z.string(),
  previous_cluster: z.string().optional(),
  new_cluster: z.string(),
  cluster_created: z.boolean(),
  dry_run: z.boolean(),
  undo_entry_id: z.string().optional(),
});

// ============================================================
// BULK_OPERATIONS TOOL TYPES
// ============================================================

export interface AtssBulkOperationItem {
  tool: AtssToolName;
  params: Record<string, unknown>;
  id?: string;
}

export const AtssBulkOperationItemSchema = z.object({
  tool: AtssToolNameSchema,
  params: z.record(z.unknown()),
  id: z.string().optional(),
});

export interface AtssBulkOperationsParams {
  operations: AtssBulkOperationItem[];
  mode: AtssBulkMode;
  dry_run?: boolean;
}

export const AtssBulkOperationsParamsSchema = z.object({
  operations: z.array(AtssBulkOperationItemSchema).min(1).max(ATSS_MAX_BULK_OPERATIONS),
  mode: AtssBulkModeSchema,
  dry_run: z.boolean().default(false),
});

export interface AtssBulkOperationResultItem {
  id?: string;
  tool: AtssToolName;
  success: boolean;
  result?: Record<string, unknown>;
  error?: AtssErrorResponse;
}

export const AtssBulkOperationResultItemSchema = z.object({
  id: z.string().optional(),
  tool: AtssToolNameSchema,
  success: z.boolean(),
  result: z.record(z.unknown()).optional(),
  error: z.object({
    error: z.literal(true),
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    tool: AtssToolNameSchema.optional(),
    timestamp: z.string().datetime(),
  }).optional(),
});

/** Persisted type — includes _schemaVersion for migration safety. */
export interface AtssBulkOperationsResult {
  success: boolean;
  transaction_id: string;
  results: AtssBulkOperationResultItem[];
  success_count: number;
  failure_count: number;
  rolled_back: boolean;
  total_credits: number;
  dry_run: boolean;
  undo_entry_id?: string;
  _schemaVersion: number;
}

export const AtssBulkOperationsResultSchema = z.object({
  success: z.boolean(),
  transaction_id: z.string(),
  results: z.array(AtssBulkOperationResultItemSchema),
  success_count: z.number().int().min(0),
  failure_count: z.number().int().min(0),
  rolled_back: z.boolean(),
  total_credits: z.number().min(0),
  dry_run: z.boolean(),
  undo_entry_id: z.string().optional(),
  _schemaVersion: z.number(),
});

/** Union type of all possible tool results. */
export type AtssToolResult =
  | AtssViewNodeResult
  | AtssSearchResult
  | AtssCreateNodeResult
  | AtssUpdateNodeResult
  | AtssDeleteNodeResult
  | AtssCreateEdgeResult
  | AtssDeleteEdgeResult
  | AtssLinkToClusterResult
  | AtssBulkOperationsResult;

// ============================================================
// TOOL DEFINITION AGGREGATE
// ============================================================

export interface AtssToolDefinition {
  name: AtssToolName;
  category: AtssToolCategory;
  description: string;
  confirmation: AtssConfirmationLevel;
  credit_cost: number;
  undo_ttl_seconds: number;
  rate_limit: { perSecond: number; burst: number };
  synthesize_format: string;
}

// ============================================================
// UNDO SYSTEM TYPES
// ============================================================

/** Persisted type — includes _schemaVersion for migration safety. */
export interface AtssUndoEntry {
  id: string;
  _schemaVersion: number;
  timestamp: string;
  expires_at: string;
  quick_undo_until: string;
  tool: AtssToolName;
  params: Record<string, unknown>;
  result: Record<string, unknown>;
  inverse_tool: AtssToolName;
  inverse_params: Record<string, unknown>;
  status: AtssUndoStatus;
  depends_on: string[];
  enables: string[];
  user_id: string;
  session_id: string;
  credit_cost: number;
}

export const AtssUndoEntrySchema = z.object({
  id: z.string().regex(/^undo_[a-zA-Z0-9_-]{12}$/),
  _schemaVersion: z.number(),
  timestamp: z.string().datetime(),
  expires_at: z.string().datetime(),
  quick_undo_until: z.string().datetime(),
  tool: AtssToolNameSchema,
  params: z.record(z.unknown()),
  result: z.record(z.unknown()),
  inverse_tool: AtssToolNameSchema,
  inverse_params: z.record(z.unknown()),
  status: AtssUndoStatusSchema,
  depends_on: z.array(z.string()),
  enables: z.array(z.string()),
  user_id: z.string(),
  session_id: z.string(),
  credit_cost: z.number().min(0),
});

export interface AtssUndoRequest {
  entry_id?: string;
}

export const AtssUndoRequestSchema = z.object({
  entry_id: z.string().optional(),
});

export interface AtssUndoResult {
  success: boolean;
  entry_id: string;
  tool: AtssToolName;
  status: AtssUndoStatus;
  credits_refunded: number;
  warning?: string;
}

export const AtssUndoResultSchema = z.object({
  success: z.boolean(),
  entry_id: z.string(),
  tool: AtssToolNameSchema,
  status: AtssUndoStatusSchema,
  credits_refunded: z.number().min(0),
  warning: z.string().optional(),
});

export interface AtssRedoRequest {
  entry_id: string;
}

export const AtssRedoRequestSchema = z.object({
  entry_id: z.string(),
});

export interface AtssRedoResult {
  success: boolean;
  entry_id: string;
  tool: AtssToolName;
  status: AtssUndoStatus;
  credits_charged: number;
}

export const AtssRedoResultSchema = z.object({
  success: z.boolean(),
  entry_id: z.string(),
  tool: AtssToolNameSchema,
  status: AtssUndoStatusSchema,
  credits_charged: z.number().min(0),
});

export interface AtssUndoMultipleRequest {
  entry_ids: string[];
}

export const AtssUndoMultipleRequestSchema = z.object({
  entry_ids: z.array(z.string()).min(1),
});

export interface AtssUndoMultipleResult {
  success: boolean;
  results: AtssUndoResult[];
  total_credits_refunded: number;
}

export const AtssUndoMultipleResultSchema = z.object({
  success: z.boolean(),
  results: z.array(AtssUndoResultSchema),
  total_credits_refunded: z.number().min(0),
});

// ============================================================
// PERMISSION & CONFIRMATION TYPES
// ============================================================

export interface AtssConfirmationRequest {
  tool: AtssToolName;
  params: Record<string, unknown>;
  confirmation_level: AtssConfirmationLevel;
  credit_cost: number;
  description: string;
}

export const AtssConfirmationRequestSchema = z.object({
  tool: AtssToolNameSchema,
  params: z.record(z.unknown()),
  confirmation_level: AtssConfirmationLevelSchema,
  credit_cost: z.number().min(0),
  description: z.string(),
});

export interface AtssConfirmationResponse {
  approved: boolean;
  modified_params?: Record<string, unknown>;
}

export const AtssConfirmationResponseSchema = z.object({
  approved: z.boolean(),
  modified_params: z.record(z.unknown()).optional(),
});

export interface AtssTierConfig {
  tier: AtssTier;
  is_student: boolean;
  daily_credit_limit?: number;
  can_bulk: boolean;
  max_bulk_operations: number;
}

export const AtssTierConfigSchema = z.object({
  tier: AtssTierSchema,
  is_student: z.boolean(),
  daily_credit_limit: z.number().int().min(0).optional(),
  can_bulk: z.boolean(),
  max_bulk_operations: z.number().int().min(0),
});

// ============================================================
// CIRCUIT BREAKER TYPES
// ============================================================

export interface AtssCircuitBreaker {
  state: AtssCircuitBreakerState;
  consecutive_failures: number;
  last_failure_at?: string;
  last_success_at?: string;
  tripped_at?: string;
}

export const AtssCircuitBreakerSchema = z.object({
  state: AtssCircuitBreakerStateSchema,
  consecutive_failures: z.number().int().min(0),
  last_failure_at: z.string().datetime().optional(),
  last_success_at: z.string().datetime().optional(),
  tripped_at: z.string().datetime().optional(),
});

// ============================================================
// RATE LIMIT TYPES
// ============================================================

export interface AtssRateLimitState {
  tool: AtssToolName;
  window_start: string;
  request_count: number;
  burst_count: number;
}

export const AtssRateLimitStateSchema = z.object({
  tool: AtssToolNameSchema,
  window_start: z.string().datetime(),
  request_count: z.number().int().min(0),
  burst_count: z.number().int().min(0),
});

// ============================================================
// DRY RUN TYPES
// ============================================================

export interface AtssDryRunResult {
  would_succeed: boolean;
  credits_required: number;
  confirmation_required: AtssConfirmationLevel;
  side_effects: string[];
  warnings: string[];
}

export const AtssDryRunResultSchema = z.object({
  would_succeed: z.boolean(),
  credits_required: z.number().min(0),
  confirmation_required: AtssConfirmationLevelSchema,
  side_effects: z.array(z.string()),
  warnings: z.array(z.string()),
});

// ============================================================
// ERROR RESPONSE TYPES
// ============================================================

export interface AtssErrorResponse {
  error: true;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  tool?: AtssToolName;
  timestamp: string;
}

export const AtssErrorResponseSchema = z.object({
  error: z.literal(true),
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  tool: AtssToolNameSchema.optional(),
  timestamp: z.string().datetime(),
});
