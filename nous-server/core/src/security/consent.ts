/**
 * @module @nous/core/security
 * @description LLM consent UX: scopes, dialog types, visual indicators, revocation
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * Consent state management, topic matching, decline handling,
 * and revocation for Private tier LLM access.
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/spec/consent-ux.ts} - Spec
 */

import {
  type ConsentScope,
  type ConsentRevocationScope,
  DECLINE_ACTIONS,
  DEFAULT_CONSENT_SCOPE,
  CONVERSATION_TIMEOUT_MINUTES,
  TOPIC_SIMILARITY_THRESHOLD,
} from './constants';

import {
  type ConsentState,
  type ConsentSettings,
  type ConsentDialogData,
  type TopicConsent,
  type ConsentRevocationRequest,
  type DeclineResult,
  type SharedMemoryDetail,
} from './types';

// ============================================================
// DEFAULT CONSENT SETTINGS
// ============================================================

/**
 * Default consent settings for new Private tier users.
 *
 * @see storm-022 v2 Section 10.2 - Defaults
 */
export const DEFAULT_CONSENT_SETTINGS: ConsentSettings = {
  default_scope: DEFAULT_CONSENT_SCOPE,
  time_based_duration: '24h',
  topic_similarity_threshold: TOPIC_SIMILARITY_THRESHOLD,
  remembered_topics: [],
  conversation_timeout_minutes: CONVERSATION_TIMEOUT_MINUTES,
  require_explicit_for_sensitive: true,
} as const;

// ============================================================
// DECLINE MESSAGE
// ============================================================

/**
 * Default message shown when user declines LLM memory access.
 *
 * @see storm-022 v2 Section 10.6 - Decline dialog copy
 */
export const DECLINE_MESSAGE =
  'I can\'t access your memories for this question. Without access, I can still help with general questions, writing assistance, and brainstorming ideas.';

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Checks if a consent state is still active (not expired).
 *
 * @param state - Consent state to check
 * @returns True if consent is still active
 */
export function isConsentActive(state: ConsentState): boolean {
  if (!state.granted) {
    return false;
  }

  if (state.expires_at) {
    return Date.now() < new Date(state.expires_at).getTime();
  }

  // per_message scope: always requires new consent
  if (state.scope === 'per_message') {
    return false;
  }

  return true;
}

/**
 * Handles user declining LLM access to memories.
 * Returns available fallback actions.
 *
 * @param _user_id - User declining access (unused in pure computation)
 * @returns Decline result with available actions
 */
export function handleDecline(_user_id: string): DeclineResult {
  return {
    declined: true,
    available_actions: [...DECLINE_ACTIONS],
    previous_context_available: false,
    message: DECLINE_MESSAGE,
  };
}

/**
 * Computes cosine similarity between two vectors.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity (0 to 1)
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Checks if a query embedding matches any remembered topic.
 * Uses cosine similarity against stored topic embeddings.
 *
 * @param query_embedding - Embedding of the current query
 * @param remembered_topics - User's remembered topic consents
 * @param threshold - Cosine similarity threshold (default: 0.85)
 * @returns Matching topic consent, or null if no match
 *
 * @see storm-022 v2 Section 10.2 - "Similarity threshold: 0.85 cosine similarity"
 */
export function checkTopicMatch(
  query_embedding: number[],
  remembered_topics: TopicConsent[],
  threshold: number = TOPIC_SIMILARITY_THRESHOLD,
): TopicConsent | null {
  let bestMatch: TopicConsent | null = null;
  let bestSimilarity = 0;

  for (const topic of remembered_topics) {
    const similarity = cosineSimilarity(query_embedding, topic.topic_embedding);
    if (similarity >= threshold && similarity > bestSimilarity) {
      bestMatch = topic;
      bestSimilarity = similarity;
    }
  }

  return bestMatch;
}

// ============================================================
// EXTERNAL SERVICE FUNCTIONS
// ============================================================

/**
 * Prepares consent dialog data for a set of memories and LLM provider.
 * Requires server-side memory lookup.
 *
 * @param _user_id - User requesting LLM access
 * @param _memory_ids - IDs of memories that would be shared
 * @param _provider - LLM provider identifier
 * @returns Data to render the consent dialog
 */
export async function requestConsent(
  _user_id: string,
  _memory_ids: string[],
  _provider: string,
): Promise<ConsentDialogData> {
  throw new Error('requestConsent requires server-side memory lookup implementation');
}

/**
 * Records that the user has granted consent.
 * Requires server-side consent state persistence.
 *
 * @param _user_id - User granting consent
 * @param _scope - Chosen consent scope
 * @param _memory_ids - IDs of memories being shared
 * @returns Updated consent state
 */
export async function grantConsent(
  _user_id: string,
  _scope: ConsentScope,
  _memory_ids: string[],
): Promise<ConsentState> {
  throw new Error('grantConsent requires consent state persistence implementation');
}

/**
 * Checks if the user has active consent for a given query.
 * Requires server-side consent state lookup.
 *
 * @param _user_id - User ID
 * @param _query_embedding - Embedding of the current query
 * @returns Active consent state, or null if no active consent
 */
export async function checkConsent(
  _user_id: string,
  _query_embedding: number[],
): Promise<ConsentState | null> {
  throw new Error('checkConsent requires consent state lookup implementation');
}

/**
 * Revokes consent at the specified granularity.
 * Requires server-side consent state update.
 *
 * @param _user_id - User revoking consent
 * @param _request - Revocation scope
 */
export async function revokeConsent(
  _user_id: string,
  _request: ConsentRevocationRequest,
): Promise<void> {
  throw new Error('revokeConsent requires consent state update implementation');
}

/**
 * Gets all memories shared in a specific conversation.
 * Requires server-side shared memory tracking.
 *
 * @param _user_id - User ID
 * @param _conversation_id - Conversation ID
 * @returns Array of shared memory details
 */
export async function getSharedMemories(
  _user_id: string,
  _conversation_id: string,
): Promise<SharedMemoryDetail[]> {
  throw new Error('getSharedMemories requires shared memory tracking implementation');
}

/**
 * Updates consent settings for a user.
 * Requires server-side settings persistence.
 *
 * @param _user_id - User ID
 * @param _settings - Partial settings to update
 */
export async function updateConsentSettings(
  _user_id: string,
  _settings: Partial<ConsentSettings>,
): Promise<void> {
  throw new Error('updateConsentSettings requires settings persistence implementation');
}
