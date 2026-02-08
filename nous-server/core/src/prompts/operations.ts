/**
 * @module @nous/core/prompts
 * @description P-009 (Agent Reasoning) + P-010/P-010B (Contradiction) + P-011 (Compression)
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-027
 * @storm Brainstorms/Infrastructure/storm-027-prompt-engineering
 *
 * These prompts handle specialized operations:
 * 1. P-009: Agent reasoning and tool selection (storm-019 integration)
 * 2. P-010: Contradiction detection (storm-009 Tier 3 — prompt defined in storm-009)
 * 3. P-010B: Contradiction verification (storm-009 Tier 4 — prompt defined in storm-009)
 * 4. P-011: Memory compression for archival (storm-007 integration)
 *
 * IMPORTANT: P-010 and P-010B prompts are DEFINED in storm-009 detection-pipeline.ts.
 * This file provides NPL metadata, examples, and integration context only.
 * The authoritative prompt text is copied here for completeness but the
 * source of truth lives in storm-009.
 *
 * @see {@link Brainstorms/Infrastructure/storm-027-prompt-engineering/revision} - v1.1 P-009, P-010B, P-011
 * @see {@link storm-009} - Contradiction detection pipeline (P-010, P-010B source)
 * @see {@link storm-019} - Agent tool specs (P-009 consumer)
 * @see {@link storm-007} - Forgetting model (P-011 consumer)
 */

import type { NplPromptMetadata, NplPromptExample } from './types';

// ============================================================
// P-009: AGENT REASONING PROMPT
// ============================================================

/**
 * P-009 system message.
 * Guides agent reasoning for tool selection and execution planning.
 *
 * @see storm-027 v1.1 P-009
 * @see storm-019 (brainstorm) - Agent tool specs, permission levels
 */
export const NPL_P009_SYSTEM_MESSAGE = `You are an AI agent that can manipulate a personal knowledge graph. You have access to tools that can search, view, create, update, and delete knowledge.

SAFETY RULES:
1. READ tools: Use freely
2. WRITE tools: Show what will change
3. DESTRUCTIVE tools: Always confirm first
4. Max 10 operations per request without explicit confirmation
5. Never delete without showing what will be deleted first

CLARIFICATION RULES (Uncertainty x Impact):
- CERTAIN + LOW IMPACT: Just act
- CERTAIN + HIGH IMPACT: Act with confirmation preview
- UNCERTAIN + LOW IMPACT: Act, then clarify ("I did X. Was that right?")
- UNCERTAIN + HIGH IMPACT: Clarify first ("Before I delete these 15 notes...")

DEFAULT BEHAVIORS:
- Always search before creating (avoid duplicates)
- Show related nodes when viewing
- Confirm destructive actions

{{TOOL_LIST}}`;

/**
 * P-009 tool list template.
 * Injected into {{TOOL_LIST}} placeholder of the system message.
 *
 * @see storm-027 v1.1 P-009 Tool List Format
 * @see storm-019 (brainstorm) for complete tool specifications
 */
export const NPL_P009_TOOL_LIST_TEMPLATE = `AVAILABLE TOOLS:

## Read Tools (no confirmation needed)
- search_nodes(query: string, filters?: {type?, cluster?, date_range?}): SearchResult[]
  Find nodes matching query. Filters narrow results.

- view_nodes(node_ids: string[], include_metadata?: bool, include_connections?: bool): ViewedNode[]
  Read full content of specific nodes.

- get_similar(node_id: string, threshold?: number): Node[]
  Find nodes similar to a given node.

- list_recent(count: number, type?: NodeType): Node[]
  Get most recently accessed/created nodes.

## Write Tools (show preview)
- create_note(content: string, title: string): Node
  Create a new note. Will search first to avoid duplicates.

- create_link(from_id: string, to_id: string, relation: string): Link
  Create relationship between two nodes.

- update_node(node_id: string, changes: {content?, title?, tags?}): Node
  Modify an existing node.

- add_tag(node_id: string, tag: string): void
  Add tag to a node.

## Destructive Tools (require confirmation)
- delete_node(node_id: string): void
  Permanently delete a node.

- merge_nodes(node_ids: string[]): Node
  Combine multiple nodes into one.

- bulk_delete(filter: {tag?, cluster?, before_date?}): {count: number, preview: Node[]}
  Delete multiple nodes matching filter. Always shows preview first.`;

/**
 * P-009 user message template.
 *
 * Placeholders:
 * - {{user_message}} - The user's request
 * - {{recent_messages}} - Recent conversation context
 * - {{context_space}} - Active context space name
 * - {{permission_set}} - User's permission level
 */
export const NPL_P009_USER_TEMPLATE = `USER REQUEST: {{user_message}}

CONVERSATION CONTEXT:
{{recent_messages}}

ACTIVE CONTEXT SPACE: {{context_space}}
USER PERMISSIONS: {{permission_set}}

Plan your approach and select tools.

Respond with ONLY this JSON:
{
  "understanding": "<what user wants>",
  "plan": [
    {
      "step": 1,
      "tool": "<tool_name>",
      "params": {<tool_parameters>},
      "reason": "<why this step>"
    }
  ],
  "needs_confirmation": <bool>,
  "confirmation_reason": "<why confirmation needed>",
  "alternative_interpretation": "<if ambiguous, other possible meaning>"
}`;

/**
 * P-009 metadata.
 */
export const NPL_P009_METADATA: NplPromptMetadata = {
  _schemaVersion: 1,
  id: 'P-009',
  name: 'Agent Reasoning',
  version: '1.1.0',
  lastUpdated: '2026-02-05',
  integratesWith: ['storm-019'],
  testedModels: ['claude-sonnet-4'],
  temperature: 0,
  cacheStrategy: 'global',
};

// ============================================================
// P-009 FEW-SHOT EXAMPLES
// ============================================================

/**
 * P-009 few-shot examples.
 *
 * @see storm-027 v1.1 P-009 examples
 */
export const NPL_P009_EXAMPLES: NplPromptExample[] = [
  {
    input: 'USER REQUEST: "Delete all my old notes about the React tutorial"\nCONVERSATION CONTEXT: []\nACTIVE CONTEXT SPACE: Work\nUSER PERMISSIONS: full',
    output: JSON.stringify({
      understanding: 'User wants to delete notes about React tutorial',
      plan: [
        {
          step: 1,
          tool: 'search_nodes',
          params: { query: 'React tutorial', filters: { cluster: 'Work' } },
          reason: 'Find all React tutorial notes before deleting',
        },
        {
          step: 2,
          tool: 'bulk_delete',
          params: { filter: { tag: 'React tutorial' } },
          reason: 'Delete matching notes after user confirms',
        },
      ],
      needs_confirmation: true,
      confirmation_reason: 'Destructive operation - need to show what will be deleted before proceeding',
      alternative_interpretation: 'User might mean only outdated notes, not all React notes',
    }),
  },
  {
    input: 'USER REQUEST: "Save this meeting summary and link it to the Project X notes"\nCONVERSATION CONTEXT: ["Here is the meeting summary: Q2 planning, budget approved $50K..."]\nACTIVE CONTEXT SPACE: Work\nUSER PERMISSIONS: full',
    output: JSON.stringify({
      understanding: 'User wants to create a meeting summary node and link it to Project X',
      plan: [
        {
          step: 1,
          tool: 'search_nodes',
          params: { query: 'Project X', filters: { cluster: 'Work' } },
          reason: 'Find Project X notes to link to',
        },
        {
          step: 2,
          tool: 'create_note',
          params: { content: 'Q2 planning, budget approved $50K...', title: 'Meeting Summary - Q2 Planning' },
          reason: 'Create the meeting summary node',
        },
        {
          step: 3,
          tool: 'create_link',
          params: { from_id: '<new_node_id>', to_id: '<project_x_id>', relation: 'part_of' },
          reason: 'Link meeting summary to Project X',
        },
      ],
      needs_confirmation: false,
      confirmation_reason: null,
      alternative_interpretation: null,
    }),
  },
];

// ============================================================
// P-010: CONTRADICTION DETECTION PROMPT
// ============================================================

/**
 * P-010 system message — Contradiction Detection (Tier 3).
 *
 * IMPORTANT: This prompt is DEFINED in storm-009 detection-pipeline.ts
 * as `LLM_DETECTION_PROMPT` (lines 287-319). The text below is copied
 * exactly for completeness, but the authoritative source is storm-009.
 *
 * NOTE: Storm-009 uses single-brace {placeholder} syntax, NOT {{double-brace}}.
 *
 * @see storm-009 LLM_DETECTION_PROMPT (authoritative source)
 * @see storm-009 LLMDetectionOutput for output schema
 */
export const NPL_P010_SYSTEM_MESSAGE = `You are analyzing whether new information contradicts existing information in a personal knowledge base.

EXISTING INFORMATION:
- Entity: {entity_name}
- Type: {entity_type}
- Attribute: {attribute}
- Current value: "{old_value}"
- Recorded on: {old_date}
- Source: {old_source}

NEW INFORMATION:
- Statement: "{new_statement}"
- Context (surrounding text): "{context}"
- Date: {new_date}
- Source: {new_source}

IMPORTANT: Consider these possibilities:
1. TRUE CONTRADICTION: The facts cannot both be true
2. UPDATE: The fact changed over time (both were true at time)
3. EVOLUTION: The belief/opinion developed (not contradiction)
4. DIFFERENT CONTEXT: Both could be true in different contexts
5. UNRELATED: The new info is about something else entirely

Respond with ONLY this JSON (no other text):
{
  "relationship": "contradicts|updates|evolves|coexists|unrelated",
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation in 1-2 sentences>",
  "which_is_current": "old|new|both|unclear",
  "both_could_be_true": <true|false>,
  "is_time_dependent": <true|false>,
  "needs_user_input": <true|false>
}`;

/**
 * P-010 metadata.
 * Adds NPL metadata that storm-009 doesn't provide.
 */
export const NPL_P010_METADATA: NplPromptMetadata = {
  _schemaVersion: 1,
  id: 'P-010',
  name: 'Contradiction Detection',
  version: '1.1.0',
  lastUpdated: '2026-02-05',
  integratesWith: ['storm-009'],
  testedModels: ['claude-sonnet-4', 'gpt-4o'],
  temperature: 0,
  cacheStrategy: 'global',
};

// ============================================================
// P-010 FEW-SHOT EXAMPLES
// ============================================================

/**
 * P-010 few-shot examples.
 *
 * @see storm-009 detection-pipeline.ts for Tier 3 pipeline context
 */
export const NPL_P010_EXAMPLES: NplPromptExample[] = [
  {
    input: 'EXISTING: Entity: Sarah Chen, Attribute: phone, Value: "555-1234", Recorded: 2026-01-10\nNEW: "Sarah\'s new number is 555-5678", Date: 2026-02-01',
    output: JSON.stringify({
      relationship: 'updates',
      confidence: 0.92,
      reasoning: "Phone numbers change - 'new number' indicates an update, not a contradiction. Old number was correct at time of recording.",
      which_is_current: 'new',
      both_could_be_true: false,
      is_time_dependent: true,
      needs_user_input: false,
    }),
  },
  {
    input: 'EXISTING: Entity: User, Attribute: preference, Value: "prefers React over Vue", Recorded: 2025-12-01\nNEW: "I think Vue is actually better than React now", Date: 2026-02-01',
    output: JSON.stringify({
      relationship: 'evolves',
      confidence: 0.85,
      reasoning: "Opinion/preference change over time is evolution, not contradiction. Both were true when stated.",
      which_is_current: 'new',
      both_could_be_true: false,
      is_time_dependent: true,
      needs_user_input: false,
    }),
  },
  {
    input: 'EXISTING: Entity: Meeting, Attribute: date, Value: "Project meeting on Wednesday", Recorded: 2026-01-20\nNEW: "The meeting is on Thursday", Date: 2026-01-21',
    output: JSON.stringify({
      relationship: 'contradicts',
      confidence: 0.88,
      reasoning: 'Same meeting with conflicting dates. Could be a correction or a different meeting.',
      which_is_current: 'unclear',
      both_could_be_true: false,
      is_time_dependent: false,
      needs_user_input: true,
    }),
  },
];

// ============================================================
// P-010B: CONTRADICTION VERIFICATION PROMPT
// ============================================================

/**
 * P-010B system message — Adversarial Verification (Tier 4).
 *
 * IMPORTANT: This prompt is DEFINED in storm-009 detection-pipeline.ts
 * as `VERIFICATION_PROMPT` (lines 357-376). The text below is copied
 * exactly for completeness, but the authoritative source is storm-009.
 *
 * NOTE: Storm-009 uses single-brace {placeholder} syntax.
 *
 * @see storm-009 VERIFICATION_PROMPT (authoritative source)
 * @see storm-009 VerificationOutput for output schema
 */
export const NPL_P010B_SYSTEM_MESSAGE = `You are a verification system reviewing a contradiction detection. Another system has flagged two pieces of information as potentially contradicting each other.

YOUR JOB: Find reasons the detection might be WRONG.

Think adversarially. Consider:
- Could they be about different things? (different Sarah? work vs personal?)
- Could both be true in different contexts?
- Is this an update over time rather than a contradiction?
- Is the "contradiction" actually a misunderstanding?

If you find ANY reasonable doubt, the system should NOT auto-supersede.`;

/**
 * P-010B user message template.
 *
 * NOTE: Storm-009 uses single-brace {placeholder} syntax.
 *
 * Placeholders (single-brace, per storm-009 convention):
 * - {old_value} - Existing information
 * - {entity} - Entity name
 * - {old_date} - When existing info was recorded
 * - {new_statement} - New information
 * - {new_date} - When new info was received
 */
export const NPL_P010B_USER_TEMPLATE = `A detection system believes these two pieces of information CONTRADICT each other:

EXISTING: "{old_value}" (about {entity}, recorded {old_date})
NEW: "{new_statement}" (from {new_date})

The system wants to AUTOMATICALLY mark the old information as superseded by the new information.

YOUR JOB: Find reasons this might be WRONG. Consider:
- Could they be about different things? (different Sarah?)
- Could both be true? (different contexts, times, aspects?)
- Is the "new" information actually a correction?
- Could this be a misunderstanding or ambiguity?

Respond with ONLY this JSON:
{
  "should_supersede": <true|false>,
  "confidence": <0.0-1.0>,
  "concerns": ["<concern1>", "<concern2>"] or [],
  "recommendation": "auto_supersede|queue_for_user|keep_both"
}`;

/**
 * P-010B metadata.
 * Adds NPL metadata that storm-009 doesn't provide.
 */
export const NPL_P010B_METADATA: NplPromptMetadata = {
  _schemaVersion: 1,
  id: 'P-010B',
  name: 'Contradiction Verification',
  version: '1.0.0',
  lastUpdated: '2026-02-05',
  integratesWith: ['storm-009'],
  testedModels: ['claude-sonnet-4'],
  temperature: 0,
  cacheStrategy: 'global',
};

// ============================================================
// P-010B FEW-SHOT EXAMPLES
// ============================================================

/**
 * P-010B few-shot examples.
 *
 * @see storm-027 v1.1 P-010B
 * @see storm-009 Tier 4 verification pipeline
 */
export const NPL_P010B_EXAMPLES: NplPromptExample[] = [
  {
    input: 'EXISTING: "Sarah\'s phone is 555-1234" (about Sarah Chen, recorded 2026-01-10)\nNEW: "Sarah\'s number is 555-5678" (from 2026-02-01)\nDetection: contradicts (confidence: 0.88)',
    output: JSON.stringify({
      should_supersede: true,
      confidence: 0.85,
      concerns: [],
      recommendation: 'auto_supersede',
    }),
  },
  {
    input: 'EXISTING: "Meeting with Sarah on Wednesday" (about team meeting, recorded 2026-01-20)\nNEW: "Sarah can\'t make Wednesday" (from 2026-01-21)\nDetection: contradicts (confidence: 0.75)',
    output: JSON.stringify({
      should_supersede: false,
      confidence: 0.7,
      concerns: [
        'Meeting might still happen without Sarah',
        "New info says Sarah can't make it, not that the meeting moved",
        'These could both be true - meeting exists AND Sarah has a conflict',
      ],
      recommendation: 'queue_for_user',
    }),
  },
];

// ============================================================
// P-011: MEMORY COMPRESSION PROMPT
// ============================================================

/**
 * P-011 system message.
 * Compresses multiple memory nodes into a summary for archival.
 *
 * NOTE: P-011 was abbreviated in the brainstorm ("Same as original with versioning").
 * This prompt is constructed from storm-007 v4 (Adaptive Stability Model)
 * and the compression format specified in the brainstorm.
 *
 * @see storm-027 v1.1 P-011 (abbreviated)
 * @see storm-007 v4 - Forgetting Model (two-stage compression: SUMMARIZED → ARCHIVED)
 */
export const NPL_P011_SYSTEM_MESSAGE = `You are a memory compression system. Your job is to compress multiple related knowledge nodes into a single summary node for long-term archival.

COMPRESSION RULES:
1. Preserve KEY FACTS - names, dates, numbers, decisions
2. Remove redundancy - merge overlapping information
3. Maintain attribution - note where key facts came from
4. Keep the summary self-contained - readable without original nodes
5. Follow the summary format below

SUMMARY FORMAT:
"In [timeframe], you learned about [topic]: [key points]. [N] related concepts."

TWO-STAGE COMPRESSION (from storm-007):
- Stage 1 (SUMMARIZED): Nodes below activity threshold get summarized
  - Preserve all key facts and relationships
  - Remove verbose content, keep essence
  - Target: 30-50% of original content length
- Stage 2 (ARCHIVED): Long-dormant summaries get further compressed
  - Reduce to key takeaways only
  - Target: 10-20% of original content length

WHAT TO PRESERVE (in order of priority):
1. Unique facts and data (numbers, dates, names)
2. Decisions and their reasoning
3. Relationships between entities
4. Temporal ordering of events
5. User preferences and opinions

WHAT TO DISCARD:
- Conversational filler
- Duplicate information across nodes
- Low-confidence or uncertain statements
- Generic information available elsewhere`;

/**
 * P-011 user message template.
 *
 * Placeholders:
 * - {{nodes_to_compress}} - Nodes with their content, types, and dates
 * - {{compression_level}} - 'summarized' or 'archived'
 * - {{topic_hint}} - Optional topic for grouping context
 */
export const NPL_P011_USER_TEMPLATE = `Compress these memory nodes into a single summary:

COMPRESSION LEVEL: {{compression_level}}
TOPIC: {{topic_hint}}

NODES TO COMPRESS:
{{nodes_to_compress}}

Respond with ONLY this JSON:
{
  "summary": "<compressed content following the summary format>",
  "title": "<short title for the summary node>",
  "key_points": ["<key point 1>", "<key point 2>", ...],
  "source_count": <number of source nodes>,
  "timeframe": "<date range covered, e.g., 'January 2026'>",
  "topic": "<main topic>",
  "related_concepts_count": <number of related concepts preserved>
}`;

/**
 * P-011 metadata.
 */
export const NPL_P011_METADATA: NplPromptMetadata = {
  _schemaVersion: 1,
  id: 'P-011',
  name: 'Memory Compression',
  version: '1.1.0',
  lastUpdated: '2026-02-05',
  integratesWith: ['storm-007'],
  testedModels: ['claude-3-haiku', 'gpt-4o-mini'],
  temperature: 0,
  cacheStrategy: 'global',
};

// ============================================================
// P-011 FEW-SHOT EXAMPLES
// ============================================================

/**
 * P-011 few-shot examples.
 *
 * @see storm-007 v4 - Adaptive Stability Model
 */
export const NPL_P011_EXAMPLES: NplPromptExample[] = [
  {
    input: 'COMPRESSION LEVEL: summarized\nTOPIC: React learning\n\nNODES TO COMPRESS:\n[N001] NOTE: "Started React tutorial - components are like functions" (2026-01-05)\n[N002] NOTE: "React hooks are great - useState, useEffect" (2026-01-07)\n[N003] IDEA: "Use React for the Health App frontend" (2026-01-10)\n[N004] FACT: "React v19 supports server components" (2026-01-12)',
    output: JSON.stringify({
      summary: 'In early January 2026, you learned about React: components are like functions, hooks (useState, useEffect) are key tools, and React v19 supports server components. You decided to use React for the Health App frontend. 3 related concepts.',
      title: 'React Learning Summary - Jan 2026',
      key_points: [
        'React components are like functions',
        'Key hooks: useState, useEffect',
        'React v19 supports server components',
        'Decision: Use React for Health App frontend',
      ],
      source_count: 4,
      timeframe: 'January 5-12, 2026',
      topic: 'React learning',
      related_concepts_count: 3,
    }),
  },
  {
    input: "COMPRESSION LEVEL: archived\nTOPIC: Q1 meetings\n\nNODES TO COMPRESS:\n[S001] SUMMARY: \"In January 2026, you had 5 team meetings: Q1 planning (budget $50K approved), sprint reviews, and a client demo. Key decisions: adopt React, hire 2 developers.\" (summarized 2026-02-01)",
    output: JSON.stringify({
      summary: 'Q1 2026 meetings: Budget $50K approved, adopted React, planned to hire 2 developers. 5 meetings total.',
      title: 'Q1 2026 Meetings - Archived',
      key_points: [
        'Budget: $50K approved',
        'Tech decision: React adopted',
        'Hiring: 2 developers planned',
      ],
      source_count: 1,
      timeframe: 'January 2026',
      topic: 'Q1 meetings',
      related_concepts_count: 3,
    }),
  },
];
