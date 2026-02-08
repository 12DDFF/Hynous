/**
 * @module @nous/core/prompts
 * @description P-001 (Query Classification), P-002 (Intent Extraction v1.2), P-002C (Clarification)
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-027
 * @storm Brainstorms/Infrastructure/storm-027-prompt-engineering
 *
 * These three prompts form the classification and intent detection pipeline:
 * 1. P-001 classifies queries into RETRIEVAL/DIRECT_TASK/CHAT
 * 2. P-002 extracts detailed intent (10 types) with entities and temporal refs
 * 3. P-002C generates clarification questions for ambiguous intents
 *
 * @see {@link Brainstorms/Infrastructure/storm-027-prompt-engineering/revision} - v1.1 P-001, P-002
 * @see {@link Brainstorms/Infrastructure/storm-027-prompt-engineering/cycles/cycle-2/revision} - v2 P-002 v1.2, P-002C
 */

import type { NplPromptMetadata, NplPromptExample } from './types';

// ============================================================
// P-001: QUERY CLASSIFICATION PROMPT
// ============================================================

/**
 * P-001 system message.
 * Classifies user messages into RETRIEVAL, DIRECT_TASK, or CHAT.
 *
 * @see storm-027 v1.1 P-001
 * @see storm-008 for QCS integration (P-001 is fallback when rules fail)
 */
export const NPL_P001_SYSTEM_MESSAGE = `You are a query classifier for a personal knowledge management system. Your job is to analyze user messages and classify them into one of three categories:

1. RETRIEVAL - User wants information from their stored memories/notes
2. DIRECT_TASK - User wants you to do something that doesn't require their memories
3. CHAT - Social interaction, greetings, or casual conversation

You must also score how likely the query needs memory retrieval, whether it's a standalone task, and whether context seems to be missing.

DISQUALIFIERS (if any present, add to output array - these force Phase 2 processing):
- reasoning_required: Contains "how does", "why", "relate", "compare", "explain", "analyze"
- temporal_reference: Contains "last week", "yesterday", "in September", "before", "after", time-specific language
- compound_query: Multiple distinct questions in one message
- negation: Contains "not", "missing", "without", "never", "don't have"
- unresolved_pronoun: Contains "their", "it", "that", "they" without clear referent in message
- exploration: Contains "what else", "similar to", "like this", "more about"
- needs_current_data: Asks about weather, news, stock prices, live data

CLASSIFICATION RULES:
- If message contains greeting words only (hi, hello, thanks) -> CHAT
- If message is a question about user's memories/notes -> RETRIEVAL
- If message asks for general knowledge/calculation -> DIRECT_TASK
- If uncertain, prefer RETRIEVAL (safer to check memory than miss it)`;

/**
 * P-001 user message template.
 *
 * Placeholders:
 * - {{user_message}} - The user's message to classify
 */
export const NPL_P001_USER_TEMPLATE = `Analyze this user message and classify it:

MESSAGE: {{user_message}}

Respond with ONLY this JSON (no other text):
{
  "classification": "RETRIEVAL" | "DIRECT_TASK" | "CHAT",
  "memory_query_score": <0.0-1.0>,
  "direct_task_score": <0.0-1.0>,
  "context_missing_score": <0.0-1.0>,
  "disqualifiers": ["<disqualifier_name>", ...] | [],
  "reasoning": "<brief explanation>"
}`;

/**
 * P-001 metadata.
 */
export const NPL_P001_METADATA: NplPromptMetadata = {
  _schemaVersion: 1,
  id: 'P-001',
  name: 'Query Classification',
  version: '1.1.0',
  lastUpdated: '2026-02-05',
  integratesWith: ['storm-008'],
  testedModels: ['gemini-flash', 'gpt-4o-mini'],
  temperature: 0,
  cacheStrategy: 'global',
};

// ============================================================
// P-001 FEW-SHOT EXAMPLES
// ============================================================

/**
 * P-001 few-shot examples.
 *
 * @see storm-027 v1.1 P-001 Few-Shot Examples
 */
export const NPL_P001_EXAMPLES: NplPromptExample[] = [
  {
    input: "What did Sarah say about the project deadline?",
    output: JSON.stringify({
      classification: 'RETRIEVAL',
      memory_query_score: 0.95,
      direct_task_score: 0.05,
      context_missing_score: 0.1,
      disqualifiers: [],
      reasoning: 'User asking about specific person (Sarah) and topic (deadline) - needs memory lookup',
    }),
  },
  {
    input: 'Convert 50 USD to EUR',
    output: JSON.stringify({
      classification: 'DIRECT_TASK',
      memory_query_score: 0.05,
      direct_task_score: 0.95,
      context_missing_score: 0.0,
      disqualifiers: [],
      reasoning: 'Currency conversion is a standalone calculation, no memory needed',
    }),
  },
  {
    input: 'How do my project notes relate to what I learned last week about machine learning?',
    output: JSON.stringify({
      classification: 'RETRIEVAL',
      memory_query_score: 0.9,
      direct_task_score: 0.1,
      context_missing_score: 0.2,
      disqualifiers: ['reasoning_required', 'temporal_reference'],
      reasoning: "Asks about relationships (reasoning_required) and references 'last week' (temporal_reference) - force Phase 2",
    }),
  },
  {
    input: 'Thanks, that was helpful!',
    output: JSON.stringify({
      classification: 'CHAT',
      memory_query_score: 0.0,
      direct_task_score: 0.1,
      context_missing_score: 0.0,
      disqualifiers: [],
      reasoning: 'Gratitude expression, social interaction',
    }),
  },
  {
    input: 'What did they decide about it?',
    output: JSON.stringify({
      classification: 'RETRIEVAL',
      memory_query_score: 0.7,
      direct_task_score: 0.1,
      context_missing_score: 0.9,
      disqualifiers: ['unresolved_pronoun'],
      reasoning: "'they' and 'it' have no clear referent - high context_missing, need clarification",
    }),
  },
];

// ============================================================
// P-002: INTENT EXTRACTION PROMPT (v1.2)
// ============================================================

/**
 * P-002 system message (v1.2).
 * Extended in v2 with 10 intents, multi-intent, retrieval modes.
 *
 * @see storm-027 v2 - Updated P-002
 * @see storm-014 for ingestion pipeline integration
 */
export const NPL_P002_SYSTEM_MESSAGE = `You are an intent detector for a personal knowledge system. Analyze user messages to determine what the user wants to do with their knowledge.

INTENT TYPES (v2 - 10 intents):
- STORE: User wants to save new information
- RETRIEVE: User wants to find existing information
- UPDATE: User wants to modify existing information
- DELETE: User wants to remove information
- SEARCH: User wants to browse/explore without specific target
- CHAT: General conversation, not about knowledge management
- COMMAND: System action (settings, export, help)
- ORGANIZE: User wants to restructure (move, link, cluster, tag)
- SUMMARIZE: User wants condensed view (retrieval mode)
- COMPARE: User wants to see differences (retrieval mode)
- CLARIFY: User is providing additional context for previous query

INTENT HIERARCHY:
- SUMMARIZE and COMPARE are modes of RETRIEVE
- When detected, return intent: "RETRIEVE" with retrieval_mode: "summarize" | "compare"

MULTI-INTENT DETECTION:
- Some queries have two intents (e.g., "Remember this and show me what else I have")
- Report secondary_intent if present, with confidence
- Determine execution_order based on precedence rules

ACTION VERB SIGNALS (critical for distinguishing review vs store):

STORE VERBS (explicit save intent):
- "remember", "save", "note down", "keep track", "store", "record", "log"
- Presence of these = save_signal: "explicit"

REVIEW VERBS (NOT store intent - user wants evaluation, not storage):
- "review", "check", "proofread", "edit", "look over", "evaluate", "critique", "assess"
- If review verbs WITHOUT store verbs = save_signal: "none"

AMBIGUOUS PHRASES (need context):
- "look at this", "see this", "here's", "check this out"
- Default to save_signal: "implicit" unless review context is clear

IMPLICIT STORE SIGNALS (no explicit verb but worth saving):
- Personal facts: "I am...", "My ... is..."
- Preferences: "I prefer...", "I like...", "I think..."
- Decisions: "I decided...", "We agreed..."
- Events: "I met...", "We had a meeting..."
- These get save_signal: "implicit" (high value even without "remember")

DETECTION PRIORITY (when uncertain):
1. CLARIFY if message is very short and follows a clarification request
2. DELETE if destructive verb present (requires high confidence)
3. UPDATE if correction pattern detected
4. STORE if store verbs or implicit save signals
5. RETRIEVE if question or search pattern
6. Default to CHAT for general messages

TEMPORAL PARSING:
- Parse relative times to actual dates when possible
- "yesterday" -> calculate actual date
- "last week" -> date range
- "in September" -> month reference`;

/**
 * P-002 user message template (v1.2).
 *
 * Placeholders:
 * - {{user_message}} - The user's message
 * - {{last_3_messages}} - Recent conversation context
 * - {{current_date_iso}} - Current date in ISO format
 * - {{is_awaiting_clarification}} - Whether system just asked for clarification
 */
export const NPL_P002_USER_TEMPLATE = `Analyze this user message for intent:

MESSAGE: {{user_message}}
CONVERSATION_CONTEXT: {{last_3_messages}}
CURRENT_DATE: {{current_date_iso}}
AWAITING_CLARIFICATION: {{is_awaiting_clarification}}

Respond with ONLY this JSON:
{
  "intent": "<INTENT_TYPE>",
  "confidence": <0.0-1.0>,
  "is_explicit": <true|false>,
  "secondary_intent": "<INTENT_TYPE>" | null,
  "secondary_confidence": <0.0-1.0> | null,
  "retrieval_mode": "direct" | "summarize" | "compare" | null,
  "multi_intent_pattern": "<pattern_name>" | null,
  "execution_order": ["<intent1>", "<intent2>"] | ["<intent>"],
  "entities": [{"name": "<entity>", "type": "person|place|thing|concept|event|organization"}],
  "temporal": {
    "has_reference": <bool>,
    "parsed": "<ISO date or null>",
    "relative": "<original text or null>"
  },
  "save_signal": "explicit" | "implicit" | "none",
  "action_verbs_detected": ["<verb1>", ...],
  "reasoning": "<brief explanation>"
}`;

/**
 * P-002 metadata (v1.2).
 */
export const NPL_P002_METADATA: NplPromptMetadata = {
  _schemaVersion: 1,
  id: 'P-002',
  name: 'Intent Extraction',
  version: '1.2.0',
  lastUpdated: '2026-02-05',
  integratesWith: ['storm-014'],
  testedModels: ['gpt-4o-mini', 'claude-haiku'],
  temperature: 0,
  cacheStrategy: 'global',
};

// ============================================================
// P-002 FEW-SHOT EXAMPLES
// ============================================================

/**
 * P-002 few-shot examples.
 * Includes v1 and v2 examples covering all major intent patterns.
 *
 * @see storm-027 v1.1 P-002 Examples
 * @see storm-027 v2 Extended schema
 */
export const NPL_P002_EXAMPLES: NplPromptExample[] = [
  {
    input: "Remember that Sarah's phone number is 555-1234",
    output: JSON.stringify({
      intent: 'STORE',
      confidence: 0.95,
      is_explicit: true,
      secondary_intent: null,
      secondary_confidence: null,
      retrieval_mode: null,
      multi_intent_pattern: null,
      execution_order: ['store'],
      entities: [{ name: 'Sarah', type: 'person' }],
      temporal: { has_reference: false, parsed: null, relative: null },
      save_signal: 'explicit',
      action_verbs_detected: ['remember'],
      reasoning: "'Remember' is explicit store verb, contains factual information about person",
    }),
  },
  {
    input: 'Can you review this document and check for errors?',
    output: JSON.stringify({
      intent: 'RETRIEVE',
      confidence: 0.85,
      is_explicit: true,
      secondary_intent: null,
      secondary_confidence: null,
      retrieval_mode: null,
      multi_intent_pattern: null,
      execution_order: ['retrieve'],
      entities: [{ name: 'document', type: 'thing' }],
      temporal: { has_reference: false, parsed: null, relative: null },
      save_signal: 'none',
      action_verbs_detected: ['review', 'check'],
      reasoning: 'Review and check are evaluation verbs, not store verbs - user wants assessment, not storage',
    }),
  },
  {
    input: 'I just realized I prefer dark roast coffee over light roast',
    output: JSON.stringify({
      intent: 'STORE',
      confidence: 0.85,
      is_explicit: false,
      secondary_intent: null,
      secondary_confidence: null,
      retrieval_mode: null,
      multi_intent_pattern: null,
      execution_order: ['store'],
      entities: [
        { name: 'dark roast coffee', type: 'thing' },
        { name: 'light roast', type: 'thing' },
      ],
      temporal: { has_reference: true, parsed: '2026-01-19', relative: 'just now' },
      save_signal: 'implicit',
      action_verbs_detected: ['realized', 'prefer'],
      reasoning: "Personal preference stated - worth storing even without explicit 'remember'",
    }),
  },
  {
    input: 'Actually, the meeting is on Thursday, not Wednesday',
    output: JSON.stringify({
      intent: 'UPDATE',
      confidence: 0.92,
      is_explicit: true,
      secondary_intent: null,
      secondary_confidence: null,
      retrieval_mode: null,
      multi_intent_pattern: null,
      execution_order: ['update'],
      entities: [{ name: 'meeting', type: 'event' }],
      temporal: { has_reference: true, parsed: '2026-01-23', relative: 'Thursday' },
      save_signal: 'explicit',
      action_verbs_detected: [],
      reasoning: "'Actually' + correction pattern indicates UPDATE to existing information",
    }),
  },
  {
    input: 'Summarize my notes on machine learning',
    output: JSON.stringify({
      intent: 'RETRIEVE',
      confidence: 0.9,
      is_explicit: true,
      secondary_intent: null,
      secondary_confidence: null,
      retrieval_mode: 'summarize',
      multi_intent_pattern: null,
      execution_order: ['retrieve'],
      entities: [{ name: 'machine learning', type: 'concept' }],
      temporal: { has_reference: false, parsed: null, relative: null },
      save_signal: 'none',
      action_verbs_detected: ['summarize'],
      reasoning: 'Summarize is a retrieval mode - user wants condensed view of existing notes',
    }),
  },
  {
    input: 'Remember this article and show me what else I have about AI',
    output: JSON.stringify({
      intent: 'STORE',
      confidence: 0.88,
      is_explicit: true,
      secondary_intent: 'retrieve',
      secondary_confidence: 0.82,
      retrieval_mode: null,
      multi_intent_pattern: 'store + retrieve',
      execution_order: ['store', 'retrieve'],
      entities: [{ name: 'AI', type: 'concept' }],
      temporal: { has_reference: false, parsed: null, relative: null },
      save_signal: 'explicit',
      action_verbs_detected: ['remember', 'show'],
      reasoning: "Multi-intent: 'remember' (store) + 'show me' (retrieve) - store first so retrieve includes new",
    }),
  },
];

// ============================================================
// P-002C: INTENT CLARIFICATION PROMPT
// ============================================================

/**
 * P-002C system message.
 *
 * @see storm-027 v2 - P-002C Clarification Prompt
 */
export const NPL_P002C_SYSTEM_MESSAGE = `You are helping clarify an ambiguous user request. Generate a brief, friendly clarification question that helps determine user intent.

GUIDELINES:
- Be concise (1-2 sentences)
- Offer specific options when possible
- Don't be robotic or overly formal
- If user seems frustrated, acknowledge and simplify`;

/**
 * P-002C user message template.
 *
 * Placeholders:
 * - {{user_message}} - The ambiguous user message
 * - {{intent_scores}} - Detected intents with confidence scores
 * - {{top_intent}} - Most likely intent
 * - {{top_confidence}} - Top intent confidence
 * - {{second_intent}} - Second most likely intent
 * - {{second_confidence}} - Second intent confidence
 */
export const NPL_P002C_USER_TEMPLATE = `The user said: "{{user_message}}"

Detected intents with confidence:
{{intent_scores}}

Most likely: {{top_intent}} ({{top_confidence}})
Second most likely: {{second_intent}} ({{second_confidence}})

Generate a clarification question that distinguishes between these intents.

Respond with ONLY this JSON:
{
  "clarification": "<the question to ask>",
  "options": [
    {"label": "<option 1>", "implies_intent": "<intent>"},
    {"label": "<option 2>", "implies_intent": "<intent>"}
  ],
  "fallback_intent": "<safest default if user doesn't clarify>"
}`;

/**
 * P-002C metadata.
 */
export const NPL_P002C_METADATA: NplPromptMetadata = {
  _schemaVersion: 1,
  id: 'P-002C',
  name: 'Intent Clarification',
  version: '1.0.0',
  lastUpdated: '2026-02-05',
  integratesWith: ['storm-027', 'P-002'],
  testedModels: ['gpt-4o-mini', 'claude-haiku'],
  temperature: 0.3,
  cacheStrategy: 'global',
};

// ============================================================
// P-002C FEW-SHOT EXAMPLES
// ============================================================

/**
 * P-002C few-shot examples.
 *
 * @see storm-027 v2 P-002C Examples
 */
export const NPL_P002C_EXAMPLES: NplPromptExample[] = [
  {
    input: 'Check my notes about the meeting\nIntents: retrieve (0.55), update (0.40)',
    output: JSON.stringify({
      clarification: 'Do you want to see your meeting notes, or make changes to them?',
      options: [
        { label: 'Show me the notes', implies_intent: 'retrieve' },
        { label: 'I want to edit them', implies_intent: 'update' },
      ],
      fallback_intent: 'retrieve',
    }),
  },
  {
    input: 'The project deadline\nIntents: retrieve (0.45), store (0.42), update (0.13)',
    output: JSON.stringify({
      clarification: "What about the project deadline - are you looking for it or telling me something new?",
      options: [
        { label: 'What is it?', implies_intent: 'retrieve' },
        { label: 'I want to save/update it', implies_intent: 'store' },
      ],
      fallback_intent: 'retrieve',
    }),
  },
];
