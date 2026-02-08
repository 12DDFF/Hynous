/**
 * @module @nous/core/prompts
 * @description P-003 (Node Extraction) + P-004 (Edge Relationship)
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-027
 * @storm Brainstorms/Infrastructure/storm-027-prompt-engineering
 *
 * These two prompts handle knowledge extraction from user messages:
 * 1. P-003 extracts structured knowledge nodes from free text
 * 2. P-004 detects relationships (edges) between extracted nodes
 *
 * @see {@link Brainstorms/Infrastructure/storm-027-prompt-engineering/revision} - v1.1 P-003, P-004
 * @see {@link storm-014} - Ingestion pipeline (consumes P-003 output)
 * @see {@link storm-011} - Node/edge type system
 */

import type { NplPromptMetadata, NplPromptExample } from './types';

// ============================================================
// P-003: NODE EXTRACTION PROMPT
// ============================================================

/**
 * P-003 system message.
 * Converts user messages into structured knowledge nodes.
 *
 * @see storm-027 v1.1 P-003
 * @see storm-014 for ingestion pipeline integration
 * @see storm-011 for node type definitions
 */
export const NPL_P003_SYSTEM_MESSAGE = `You are a knowledge extraction system. Convert user messages into structured knowledge nodes for a personal knowledge graph.

NODE TYPES:
- FACT: Objective information (phone numbers, dates, definitions)
- EVENT: Something that happened at a specific time
- NOTE: User's thoughts, observations, or notes
- IDEA: Creative concepts, plans, or possibilities
- TASK: Action items or todos
- REFERENCE: Links to external resources

EXTRACTION RULES:
1. Extract the CORE content - remove filler words ("Oh btw", "So basically")
2. Preserve exact values (phone numbers, dates, names)
3. One concept per node - split compound information
4. Identify entities that could connect to existing knowledge

CONTENT LIMITS (from storm-014):
- Target: 500-2000 characters per node
- Soft max: ~3000 characters (acceptable if semantically coherent)
- Hard max: 5000 characters (force split at sentence boundary)
- If content exceeds soft max, split into multiple nodes

ENTITY MATCHING:
- Check against EXISTING_ENTITIES list
- If entity name matches (case-insensitive), mark is_new: false
- If entity is genuinely new, mark is_new: true

TEMPORAL PARSING:
- Convert relative dates to ISO format when possible
- Preserve original text in relative_text
- If recurring (every Monday, weekly), mark is_recurring: true`;

/**
 * P-003 user message template.
 *
 * Placeholders:
 * - {{user_message}} - The user's message to extract from
 * - {{detected_intent}} - Intent detected by P-002
 * - {{known_entities_list}} - Existing entities in the graph
 * - {{current_date_iso}} - Current date in ISO format
 */
export const NPL_P003_USER_TEMPLATE = `Extract knowledge node(s) from this content:

CONTENT: {{user_message}}
INTENT: {{detected_intent}}
EXISTING_ENTITIES: {{known_entities_list}}
CURRENT_DATE: {{current_date_iso}}

Respond with ONLY this JSON:
{
  "nodes": [
    {
      "content": "<core content to store>",
      "type": "FACT" | "EVENT" | "NOTE" | "IDEA" | "TASK" | "REFERENCE",
      "title": "<short title, max 50 chars>",
      "entities": [{"name": "<entity>", "type": "<type>", "is_new": <bool>}],
      "temporal": {
        "occurred_at": "<ISO date or null>",
        "relative_text": "<original temporal text>",
        "is_recurring": <bool>
      },
      "suggested_edges": [{"target_hint": "<entity or concept>", "relation": "<relation_type>"}],
      "confidence": <0.0-1.0>
    }
  ],
  "extraction_notes": "<any ambiguity or decisions made>"
}

If content cannot be meaningfully extracted, return:
{
  "nodes": [],
  "extraction_notes": "<explanation of why extraction failed>"
}`;

/**
 * P-003 metadata.
 */
export const NPL_P003_METADATA: NplPromptMetadata = {
  _schemaVersion: 1,
  id: 'P-003',
  name: 'Node Extraction',
  version: '1.1.0',
  lastUpdated: '2026-02-05',
  integratesWith: ['storm-014', 'storm-011'],
  testedModels: ['gpt-4o-mini', 'claude-sonnet-4'],
  temperature: 0,
  cacheStrategy: 'global',
};

// ============================================================
// P-003 FEW-SHOT EXAMPLES
// ============================================================

/**
 * P-003 few-shot examples.
 *
 * @see storm-027 v1.1 P-003 Few-Shot Examples
 */
export const NPL_P003_EXAMPLES: NplPromptExample[] = [
  {
    input: 'Oh btw, Sarah\'s new phone number is 555-1234\nINTENT: STORE\nEXISTING_ENTITIES: ["Sarah (person)", "Work (cluster)"]\nCURRENT_DATE: "2026-01-19"',
    output: JSON.stringify({
      nodes: [
        {
          content: "Sarah's phone number is 555-1234",
          type: 'FACT',
          title: "Sarah's phone number",
          entities: [{ name: 'Sarah', type: 'person', is_new: false }],
          temporal: { occurred_at: null, relative_text: null, is_recurring: false },
          suggested_edges: [{ target_hint: 'Sarah', relation: 'attribute_of' }],
          confidence: 0.95,
        },
      ],
      extraction_notes: "Removed filler 'Oh btw', extracted core fact",
    }),
  },
  {
    input: 'I think we should use React for the frontend. Also, the deadline is March 15th.\nINTENT: STORE\nEXISTING_ENTITIES: ["Frontend (concept)"]\nCURRENT_DATE: "2026-01-19"',
    output: JSON.stringify({
      nodes: [
        {
          content: 'Recommendation: Use React for frontend',
          type: 'IDEA',
          title: 'React for frontend',
          entities: [
            { name: 'React', type: 'thing', is_new: true },
            { name: 'Frontend', type: 'concept', is_new: false },
          ],
          temporal: { occurred_at: null, relative_text: null, is_recurring: false },
          suggested_edges: [{ target_hint: 'Frontend', relation: 'implements' }],
          confidence: 0.85,
        },
        {
          content: 'Deadline: March 15th, 2026',
          type: 'FACT',
          title: 'Project deadline',
          entities: [],
          temporal: { occurred_at: '2026-03-15', relative_text: 'March 15th', is_recurring: false },
          suggested_edges: [],
          confidence: 0.95,
        },
      ],
      extraction_notes: 'Split into two nodes - opinion/idea and hard fact',
    }),
  },
  {
    input: "Hmm, I'm not sure...\nINTENT: CHAT\nEXISTING_ENTITIES: []\nCURRENT_DATE: \"2026-01-19\"",
    output: JSON.stringify({
      nodes: [],
      extraction_notes: 'Conversational filler with no factual content to extract',
    }),
  },
  {
    input: '[3000+ character technical explanation about neural networks including multiple topics]\nINTENT: STORE\nEXISTING_ENTITIES: ["Machine Learning (concept)"]\nCURRENT_DATE: "2026-01-19"',
    output: JSON.stringify({
      nodes: [
        {
          content: '[First semantically complete section ~1500 chars]',
          type: 'NOTE',
          title: 'Neural network basics',
          entities: [{ name: 'Neural Networks', type: 'concept', is_new: true }],
          temporal: { occurred_at: null, relative_text: null, is_recurring: false },
          suggested_edges: [{ target_hint: 'Machine Learning', relation: 'part_of' }],
          confidence: 0.9,
        },
        {
          content: '[Second semantically complete section ~1500 chars]',
          type: 'NOTE',
          title: 'Backpropagation explained',
          entities: [{ name: 'Backpropagation', type: 'concept', is_new: true }],
          temporal: { occurred_at: null, relative_text: null, is_recurring: false },
          suggested_edges: [{ target_hint: 'Neural network basics', relation: 'follows' }],
          confidence: 0.9,
        },
      ],
      extraction_notes: 'Split at natural topic boundary - exceeded soft limit',
    }),
  },
];

// ============================================================
// P-004: EDGE RELATIONSHIP PROMPT
// ============================================================

/**
 * P-004 system message.
 * Detects relationships between extracted or existing nodes.
 *
 * NOTE: P-004 was abbreviated in the brainstorm ("Same structure as original
 * with versioning"). This prompt is constructed from storm-011 edge types
 * and storm-031 edge weight concepts.
 *
 * @see storm-027 v1.1 P-004 (abbreviated)
 * @see storm-011 EDGE_TYPES for valid relationship types
 * @see storm-031 for edge weight calculation concepts
 */
export const NPL_P004_SYSTEM_MESSAGE = `You are an edge relationship detector for a personal knowledge graph. Given two or more nodes, determine the relationships (edges) between them.

VALID EDGE TYPES (from knowledge graph schema):
- relates_to: General topical relationship
- part_of: Node is a component or subset of another
- mentioned_in: Entity is referenced within a note/document
- causes: One node is a cause or precondition of another
- precedes: Temporal ordering (this happened before that)
- contradicts: Nodes contain conflicting information
- supersedes: Node replaces or updates another
- derived_from: Node was created based on another
- similar_to: Nodes cover similar topics or content

DETECTION RULES:
1. Only detect edges where a genuine relationship exists
2. Assign edge type based on the strongest relationship signal
3. Weight reflects relationship strength: 0.0 (weak) to 1.0 (definitive)
4. Do NOT create edges between unrelated nodes
5. Consider temporal ordering when relevant (precedes, supersedes)
6. If content directly conflicts, use contradicts (triggers storm-009)

WEIGHT GUIDELINES:
- 0.9-1.0: Definitive relationship (explicit reference, same entity)
- 0.7-0.8: Strong relationship (clear topical overlap)
- 0.5-0.6: Moderate relationship (shared concepts or entities)
- 0.3-0.4: Weak relationship (tangential connection)
- Below 0.3: Do not create edge (too speculative)`;

/**
 * P-004 user message template.
 *
 * Placeholders:
 * - {{nodes_to_analyze}} - Nodes with their content, IDs, and metadata
 * - {{existing_edges}} - Already known edges in the graph
 * - {{context_hint}} - Optional context about why these nodes are being analyzed
 */
export const NPL_P004_USER_TEMPLATE = `Analyze these nodes for relationships:

NODES:
{{nodes_to_analyze}}

EXISTING EDGES (avoid duplicates):
{{existing_edges}}

CONTEXT: {{context_hint}}

Respond with ONLY this JSON:
{
  "edges": [
    {
      "source_node_id": "<id>",
      "target_node_id": "<id>",
      "edge_type": "<type from valid edge types>",
      "description": "<brief description of relationship>",
      "weight": <0.0-1.0>,
      "confidence": <0.0-1.0>
    }
  ],
  "analysis_notes": "<any decisions or ambiguities>"
}`;

/**
 * P-004 metadata.
 */
export const NPL_P004_METADATA: NplPromptMetadata = {
  _schemaVersion: 1,
  id: 'P-004',
  name: 'Edge Relationship',
  version: '1.1.0',
  lastUpdated: '2026-02-05',
  integratesWith: ['storm-011', 'storm-031'],
  testedModels: ['gpt-4o-mini', 'claude-3-haiku'],
  temperature: 0,
  cacheStrategy: 'global',
};

// ============================================================
// P-004 FEW-SHOT EXAMPLES
// ============================================================

/**
 * P-004 few-shot examples.
 *
 * NOTE: P-004 was abbreviated in the brainstorm. These examples are
 * constructed from storm-011 edge types and storm-031 concepts.
 *
 * @see storm-011 EDGE_TYPES
 * @see storm-031 edge weight calculation
 */
export const NPL_P004_EXAMPLES: NplPromptExample[] = [
  {
    input: 'NODES:\n[N001] FACT: "Sarah\'s phone number is 555-1234" (entities: Sarah)\n[N002] EVENT: "Meeting with Sarah on Jan 15" (entities: Sarah)\nEXISTING EDGES: []\nCONTEXT: Both nodes mention Sarah',
    output: JSON.stringify({
      edges: [
        {
          source_node_id: 'N001',
          target_node_id: 'N002',
          edge_type: 'relates_to',
          description: 'Both nodes are about the same person (Sarah)',
          weight: 0.8,
          confidence: 0.9,
        },
      ],
      analysis_notes: 'Strong entity overlap (Sarah) creates relates_to edge',
    }),
  },
  {
    input: 'NODES:\n[N003] IDEA: "Use React for frontend" (entities: React, Frontend)\n[N004] NOTE: "React tutorial notes - components, hooks, state" (entities: React)\n[N005] FACT: "Project deadline: March 15th"\nEXISTING EDGES: []\nCONTEXT: Nodes from same extraction session',
    output: JSON.stringify({
      edges: [
        {
          source_node_id: 'N004',
          target_node_id: 'N003',
          edge_type: 'derived_from',
          description: 'Tutorial learning supports the React recommendation',
          weight: 0.7,
          confidence: 0.75,
        },
        {
          source_node_id: 'N003',
          target_node_id: 'N005',
          edge_type: 'relates_to',
          description: 'React decision relates to the project with the deadline',
          weight: 0.5,
          confidence: 0.6,
        },
      ],
      analysis_notes: 'N004→N003 derived_from (learning→decision); N003→N005 relates_to (same project context)',
    }),
  },
];
