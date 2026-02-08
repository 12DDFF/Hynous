/**
 * @module @nous/core/api
 * @description Data flow pipeline definitions — Chat, Sync, Ingestion flow steps
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-023
 * @storm Brainstorms/Infrastructure/storm-023-api-data-flow
 *
 * Defines the three main data flow pipelines documented in the brainstorm:
 * 1. Chat/Query Flow: Auth -> Credits -> Classify -> Embed -> Search -> SSA -> LLM -> Store
 * 2. Sync Flow: Status -> Push -> Conflict Detection -> Apply -> Resolve -> Pull
 * 3. Ingestion Flow: Receive -> Classify -> Route -> Process -> Embed -> Dedup -> Commit
 *
 * Source: storm-023 v2 brainstorm, "Data Flow Diagrams" section.
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-023/spec/data-flows.ts} - Spec
 */

import type { FlowStep, FlowExecution } from './types';
import type { FlowType } from './constants';

// ============================================================
// CHAT FLOW STEPS
// ============================================================

/**
 * Complete Chat/Query Flow pipeline (9 steps).
 *
 * ```
 * Mobile App -> API Gateway -> Services
 * 1. Validate JWT              (Auth)
 * 2. Check credits             (Credits)
 * 3. Classify query            (Classifier — storm-008)
 * 4. Embed query               (Embedding — storm-016)
 * 5. Hybrid search             (Turso — Vector + BM25)
 * 6. SSA expansion             (Graph — storm-005)
 * 7. LLM call (streaming)      (LLM Provider — storm-015)
 * 8. Deduct actual cost        (Credits)
 * 9. Store conversation        (Turso)
 * ```
 */
export const CHAT_FLOW_STEPS: readonly FlowStep[] = [
  { name: 'validate_auth', service: 'Auth', description: 'Validate JWT/API key' },
  { name: 'check_credits', service: 'Credits', description: 'Verify sufficient balance' },
  { name: 'classify_query', service: 'Classifier', description: 'Determine query type (storm-008)' },
  { name: 'embed_query', service: 'Embedding', description: 'Generate query embedding (storm-016)' },
  { name: 'hybrid_search', service: 'Turso', description: 'Vector + BM25 search (storm-016)' },
  { name: 'ssa_expansion', service: 'Graph', description: 'Spreading activation (storm-005)' },
  { name: 'llm_call', service: 'LLM Provider', description: 'Stream response (storm-015)' },
  { name: 'deduct_cost', service: 'Credits', description: 'Deduct actual cost' },
  { name: 'store_conversation', service: 'Turso', description: 'Persist conversation' },
] as const;

// ============================================================
// SYNC FLOW STEPS
// ============================================================

/**
 * Complete Sync Flow pipeline (6 steps).
 *
 * ```
 * Mobile App -> API Gateway -> Turso Cloud
 * 1. Check status              (Turso)
 * 2. Push changes              (Turso)
 * 3. Detect conflicts          (NSE — storm-033)
 * 4. Apply non-conflicting     (Turso)
 * 5. Resolve conflicts         (NSE + User — storm-033)
 * 6. Pull changes              (Turso)
 * ```
 */
export const SYNC_FLOW_STEPS: readonly FlowStep[] = [
  { name: 'check_status', service: 'Turso', description: 'Get current sync state' },
  { name: 'push_changes', service: 'Turso', description: 'Send local changes to server' },
  { name: 'detect_conflicts', service: 'NSE', description: 'Check for concurrent edits (storm-033)' },
  { name: 'apply_nonconflicting', service: 'Turso', description: 'Apply clean changes' },
  { name: 'resolve_conflicts', service: 'NSE + User', description: 'Auto-merge or user resolution' },
  { name: 'pull_changes', service: 'Turso', description: 'Fetch remote changes since last sync' },
] as const;

// ============================================================
// INGESTION FLOW STEPS
// ============================================================

/**
 * Complete Ingestion Flow pipeline (8 steps).
 *
 * ```
 * Mobile App -> API Gateway -> Services
 * 1. Receive                   (Adapter — storm-014 stage 1)
 * 2. Classify                  (Classifier — storm-014 stage 2)
 * 3. Route                     (Router — select handler)
 * 4. Process                   (Extractor — extract concepts)
 * 5. Stage: Embed              (Embedding — storm-016)
 * 6. Stage: Dedup              (Turso — check duplicates)
 * 7. Commit: Nodes             (Turso — create records)
 * 8. Commit: Edges             (Graph — create edges)
 * ```
 */
export const INGESTION_FLOW_STEPS: readonly FlowStep[] = [
  { name: 'receive', service: 'Adapter', description: 'Normalize input (storm-014 stage 1)' },
  { name: 'classify', service: 'Classifier', description: 'Intent + save signal (storm-014 stage 2)' },
  { name: 'route', service: 'Router', description: 'Select handler based on classification' },
  { name: 'process', service: 'Extractor', description: 'Extract concepts if content type' },
  { name: 'stage_embed', service: 'Embedding', description: 'Generate embeddings (storm-016)' },
  { name: 'stage_dedup', service: 'Turso', description: 'Check for duplicates' },
  { name: 'commit_nodes', service: 'Turso', description: 'Create node records' },
  { name: 'commit_edges', service: 'Graph', description: 'Create edge records' },
] as const;

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Get flow step definitions for a given flow type.
 *
 * @param flowType - One of 'chat', 'sync', 'ingestion'
 * @returns Array of flow steps for the specified flow
 */
export function getFlowSteps(flowType: FlowType): readonly FlowStep[] {
  switch (flowType) {
    case 'chat':
      return CHAT_FLOW_STEPS;
    case 'sync':
      return SYNC_FLOW_STEPS;
    case 'ingestion':
      return INGESTION_FLOW_STEPS;
  }
}

/**
 * Create a new flow execution tracker.
 *
 * @param flowType - Flow type to track
 * @param requestId - Unique request ID for this execution
 * @returns A new FlowExecution instance starting at step 0
 */
export function createFlowExecution(flowType: FlowType, requestId: string): FlowExecution {
  const steps = getFlowSteps(flowType);
  const firstStep = steps[0];
  return {
    flow_type: flowType,
    request_id: requestId,
    current_step: firstStep ? firstStep.name : '',
    started_at: Date.now(),
    steps_completed: [],
  };
}
