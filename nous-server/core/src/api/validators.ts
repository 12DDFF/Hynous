/**
 * @module @nous/core/api
 * @description Request body validation — Zod-based validators for API endpoint request bodies
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Validation functions that parse request bodies using Zod schemas from types.ts.
 * Returns typed, validated data or throws a ZodError.
 *
 * These are thin wrappers around Zod's `.parse()` — the schemas do the real work.
 * The validators provide a clean API surface and can be used in route handlers.
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-023/spec/types.ts} - Schema definitions
 */

import type {
  CreateNodeRequest,
  UpdateNodeRequest,
  BatchCreateNodesRequest,
  CreateEdgeRequest,
  UpdateEdgeRequest,
  ChatRequest,
  ExecuteActionRequest,
  IngestTextRequest,
  SyncPushRequest,
  ResolveConflictRequest,
  FullSyncRequest,
  UpdateSettingsRequest,
  CreateAPIKeyRequest,
  CostEstimateRequest,
  AdvancedSearchRequest,
} from './types';

import {
  CreateNodeRequestSchema,
  UpdateNodeRequestSchema,
  BatchCreateNodesRequestSchema,
  CreateEdgeRequestSchema,
  UpdateEdgeRequestSchema,
  ChatRequestSchema,
  ExecuteActionRequestSchema,
  IngestTextRequestSchema,
  SyncPushRequestSchema,
  ResolveConflictRequestSchema,
  FullSyncRequestSchema,
  UpdateSettingsRequestSchema,
  CreateAPIKeyRequestSchema,
  CostEstimateRequestSchema,
  AdvancedSearchRequestSchema,
} from './types';

// ============================================================
// NODE VALIDATORS
// ============================================================

/** Validate a POST /v1/nodes request body. */
export function validateCreateNodeRequest(data: unknown): CreateNodeRequest {
  return CreateNodeRequestSchema.parse(data);
}

/** Validate a PATCH /v1/nodes/:id request body. */
export function validateUpdateNodeRequest(data: unknown): UpdateNodeRequest {
  return UpdateNodeRequestSchema.parse(data);
}

/** Validate a POST /v1/nodes/batch request body. */
export function validateBatchCreateNodesRequest(data: unknown): BatchCreateNodesRequest {
  return BatchCreateNodesRequestSchema.parse(data);
}

// ============================================================
// EDGE VALIDATORS
// ============================================================

/** Validate a POST /v1/edges request body. */
export function validateCreateEdgeRequest(data: unknown): CreateEdgeRequest {
  return CreateEdgeRequestSchema.parse(data);
}

/** Validate a PATCH /v1/edges/:id request body. */
export function validateUpdateEdgeRequest(data: unknown): UpdateEdgeRequest {
  return UpdateEdgeRequestSchema.parse(data);
}

// ============================================================
// SEARCH VALIDATORS
// ============================================================

/** Validate a POST /v1/search request body. */
export function validateAdvancedSearchRequest(data: unknown): AdvancedSearchRequest {
  return AdvancedSearchRequestSchema.parse(data);
}

// ============================================================
// CHAT VALIDATORS
// ============================================================

/** Validate a POST /v1/chat request body. */
export function validateChatRequest(data: unknown): ChatRequest {
  return ChatRequestSchema.parse(data);
}

// ============================================================
// AGENT VALIDATORS
// ============================================================

/** Validate a POST /v1/agent/actions request body. */
export function validateExecuteActionRequest(data: unknown): ExecuteActionRequest {
  return ExecuteActionRequestSchema.parse(data);
}

// ============================================================
// INGESTION VALIDATORS
// ============================================================

/** Validate a POST /v1/ingest request body. */
export function validateIngestTextRequest(data: unknown): IngestTextRequest {
  return IngestTextRequestSchema.parse(data);
}

// ============================================================
// SYNC VALIDATORS
// ============================================================

/** Validate a POST /v1/sync/push request body. */
export function validateSyncPushRequest(data: unknown): SyncPushRequest {
  return SyncPushRequestSchema.parse(data);
}

/** Validate a POST /v1/sync/conflicts/:id/resolve request body. */
export function validateResolveConflictRequest(data: unknown): ResolveConflictRequest {
  return ResolveConflictRequestSchema.parse(data);
}

/** Validate a POST /v1/sync/full request body. */
export function validateFullSyncRequest(data: unknown): FullSyncRequest {
  return FullSyncRequestSchema.parse(data);
}

// ============================================================
// SETTINGS VALIDATORS
// ============================================================

/** Validate a PATCH /v1/settings request body. */
export function validateUpdateSettingsRequest(data: unknown): UpdateSettingsRequest {
  return UpdateSettingsRequestSchema.parse(data);
}

/** Validate a POST /v1/settings/api-keys request body. */
export function validateCreateAPIKeyRequest(data: unknown): CreateAPIKeyRequest {
  return CreateAPIKeyRequestSchema.parse(data);
}

// ============================================================
// CREDITS VALIDATORS
// ============================================================

/** Validate a POST /v1/credits/estimate request body. */
export function validateCostEstimateRequest(data: unknown): CostEstimateRequest {
  return CostEstimateRequestSchema.parse(data);
}
