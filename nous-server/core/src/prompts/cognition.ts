/**
 * @module @nous/core/prompts
 * @description P-005 (Orient), P-006 (Explore), P-007 (Synthesize)
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-027
 * @storm Brainstorms/Infrastructure/storm-027-prompt-engineering
 *
 * These three prompts form the Phase 2 cognition pipeline (storm-003):
 * 1. P-005 Orient: Select entry points from concept map
 * 2. P-006 Explore: Traverse graph from entry points
 * 3. P-007 Synthesize: Compose answer from discovered insights
 *
 * Pipeline: P-005 output → P-006 input → P-007 input → Final answer
 *
 * @see {@link Brainstorms/Infrastructure/storm-027-prompt-engineering/revision} - v1.1 P-005, P-006, P-007
 * @see {@link storm-003} - Phase 2 cognition (Orient→Explore→Synthesize)
 */

import type { NplPromptMetadata, NplPromptExample } from './types';

// ============================================================
// P-005: ORIENT PROMPT (Entry Point Selection)
// ============================================================

/**
 * P-005 system message.
 * Selects 2-3 entry points from a concept map for graph exploration.
 *
 * @see storm-027 v1.1 P-005
 * @see storm-003 OrientResult, EntryPoint
 */
export const NPL_P005_SYSTEM_MESSAGE = `You are navigating a personal knowledge graph to answer a user's question. You've been given a concept map of relevant nodes (found through automatic search).

Your job is to pick 2-3 ENTRY POINTS - the best nodes to start exploring from.

SELECTION CRITERIA (in order of importance):
1. Direct relevance to the question (mentions key terms)
2. Information density (prefer notes/documents over fragments)
3. Connectivity (nodes with more edges are often more useful)
4. Recency (prefer recent if query has temporal aspect)

DON'T just pick the highest-scored nodes. Use judgment about which paths will be most fruitful.

IF CONCEPT MAP IS POOR:
- If fewer than 3 nodes or all scores < 0.4, note this
- Suggest what's missing or how query could be clarified
- Still pick best available options`;

/**
 * P-005 user message template.
 *
 * Placeholders:
 * - {{user_query}} - The user's question
 * - {{concept_map}} - Formatted concept map with node IDs, types, scores, edge counts
 */
export const NPL_P005_USER_TEMPLATE = `QUESTION: {{user_query}}

CONCEPT MAP (format: [ID] type: title - snippet | Score: X.XX | Edges: N):
{{concept_map}}

Select 2-3 entry points and explain why each is a good starting point.

Respond with ONLY this JSON:
{
  "entry_points": [
    {
      "node_id": "<id>",
      "reason": "<why this is a good entry point>",
      "expected_direction": "<what we might find exploring from here>"
    }
  ],
  "exploration_strategy": "<brief plan for how to explore>",
  "concept_map_quality": "good" | "sparse" | "poor",
  "quality_notes": "<if sparse/poor, what's missing>"
}`;

/**
 * P-005 metadata.
 */
export const NPL_P005_METADATA: NplPromptMetadata = {
  _schemaVersion: 1,
  id: 'P-005',
  name: 'Orient (Phase 2)',
  version: '1.1.0',
  lastUpdated: '2026-02-05',
  integratesWith: ['storm-003'],
  testedModels: ['claude-3-haiku', 'gpt-4o-mini'],
  temperature: 0,
  cacheStrategy: 'global',
};

// ============================================================
// P-005 FEW-SHOT EXAMPLES
// ============================================================

/**
 * P-005 few-shot examples.
 *
 * @see storm-027 v1.1 P-005 Few-Shot Examples
 */
export const NPL_P005_EXAMPLES: NplPromptExample[] = [
  {
    input: 'QUESTION: "How does my ML work relate to my health goals?"\n\nCONCEPT MAP:\n[N001] person: Sarah - ML lead | Score: 0.72 | Edges: 5\n[N002] project: Health App - Q2 fitness tracking | Score: 0.85 | Edges: 8\n[N003] concept: Neural Nets - deep learning basics | Score: 0.68 | Edges: 3\n[N004] note: Career goals - want to work in healthtech | Score: 0.78 | Edges: 4\n[N005] fact: Gym membership - started Jan 2026 | Score: 0.55 | Edges: 1',
    output: JSON.stringify({
      entry_points: [
        {
          node_id: 'N002',
          reason: 'Health App project directly bridges ML work and health - highest relevance and edge count',
          expected_direction: 'May link to specific ML techniques used and health metrics tracked',
        },
        {
          node_id: 'N004',
          reason: 'Career goals mention healthtech - explicit statement of intent connecting both domains',
          expected_direction: 'May reveal motivation and specific ways user wants to combine interests',
        },
      ],
      exploration_strategy: 'Start with Health App for concrete connections, then Career goals for user intent',
      concept_map_quality: 'good',
      quality_notes: null,
    }),
  },
  {
    input: 'QUESTION: "What did we discuss about the new product feature?"\n\nCONCEPT MAP:\n[N001] note: Meeting notes - various topics | Score: 0.35 | Edges: 2\n[N002] fact: Product name - Widget Pro | Score: 0.28 | Edges: 1',
    output: JSON.stringify({
      entry_points: [
        {
          node_id: 'N001',
          reason: 'Only node that might contain discussion content',
          expected_direction: 'Search within meeting notes for product feature mentions',
        },
      ],
      exploration_strategy: 'Explore meeting notes, but results may be limited',
      concept_map_quality: 'sparse',
      quality_notes: 'No direct product feature discussions found. Query might benefit from specifying: which product? what timeframe? who was involved?',
    }),
  },
];

// ============================================================
// P-006: EXPLORE PROMPT (Graph Traversal)
// ============================================================

/**
 * P-006 system message.
 * Traverses the knowledge graph from entry points, collecting findings.
 *
 * NOTE: P-006 was abbreviated in the brainstorm ("Same as original with versioning").
 * This prompt is constructed from storm-003 v5 bounded Graph-CoT traversal rules.
 *
 * @see storm-027 v1.1 P-006 (abbreviated)
 * @see storm-003 v5 - Bounded Graph-CoT (max 6 hops, max 3 iterations)
 */
export const NPL_P006_SYSTEM_MESSAGE = `You are exploring a personal knowledge graph to find information relevant to a user's question. You are at a specific node and can see its adjacent nodes (connected by edges).

EXPLORATION RULES:
1. Extract goal-relevant information from the current node
2. Decide which adjacent nodes to explore next
3. Maximum 6 hops total across all iterations
4. Maximum 3 exploration iterations
5. Stop when: answer found, all paths exhausted, or budget exceeded

TRAVERSAL STRATEGY:
- Follow edges that are likely to lead toward the answer
- Prefer stronger edges (higher weight) when uncertain
- Avoid revisiting nodes already explored
- If a node is irrelevant, note why and move on

FINDING EXTRACTION:
- At each node, extract ONLY information relevant to the question
- Note the node ID for source attribution
- Rate the finding's relevance to the question

WHEN TO STOP:
- Found a complete or sufficient answer
- All reachable nodes explored
- 6 hops reached (hard limit)
- Remaining paths are unlikely to yield useful information

DEAD-END HANDLING:
- If a path leads nowhere, explain why and backtrack
- Consider alternative interpretation of the question
- Note what information would have been useful if present`;

/**
 * P-006 user message template.
 *
 * Placeholders:
 * - {{exploration_context}} - Current exploration state (question, findings so far)
 * - {{current_node}} - Current node content and metadata
 * - {{adjacent_nodes}} - Connected nodes with edge types and weights
 * - {{hops_remaining}} - Number of hops left in budget
 * - {{visited_nodes}} - Already visited node IDs
 */
export const NPL_P006_USER_TEMPLATE = `EXPLORATION CONTEXT:
{{exploration_context}}

CURRENT NODE:
{{current_node}}

ADJACENT NODES (format: [ID] type: title | Edge: relation (weight) | Score: X.XX):
{{adjacent_nodes}}

HOPS REMAINING: {{hops_remaining}}
ALREADY VISITED: {{visited_nodes}}

Explore and decide next steps.

Respond with ONLY this JSON:
{
  "steps": [
    {
      "node_id": "<current or adjacent node ID>",
      "from_edge": "<edge type that led here>",
      "finding": "<what relevant information was found>",
      "should_continue": <true|false>,
      "reason": "<why continue or stop>"
    }
  ],
  "findings": ["<finding1>", "<finding2>"],
  "should_continue_exploring": <true|false>,
  "stop_reason": "<reason for stopping>" | null
}`;

/**
 * P-006 metadata.
 */
export const NPL_P006_METADATA: NplPromptMetadata = {
  _schemaVersion: 1,
  id: 'P-006',
  name: 'Explore (Phase 2)',
  version: '1.1.0',
  lastUpdated: '2026-02-05',
  integratesWith: ['storm-003'],
  testedModels: ['claude-3-haiku', 'gpt-4o-mini'],
  temperature: 0,
  cacheStrategy: 'global',
};

// ============================================================
// P-006 FEW-SHOT EXAMPLES
// ============================================================

/**
 * P-006 few-shot examples.
 *
 * NOTE: P-006 was abbreviated in the brainstorm. These examples are
 * constructed from storm-003 v5 bounded traversal concepts.
 *
 * @see storm-003 ExploreResult, ExplorationHop
 */
export const NPL_P006_EXAMPLES: NplPromptExample[] = [
  {
    input: 'EXPLORATION CONTEXT:\nQuestion: "How does my ML work relate to my health goals?"\nFindings so far: []\n\nCURRENT NODE:\n[N002] project: Health App - "Q2 fitness tracking project using CNN for activity recognition"\n\nADJACENT NODES:\n[N003] concept: Neural Nets | Edge: uses (0.85) | Score: 0.68\n[N004] note: Career goals | Edge: relates_to (0.6) | Score: 0.78\n[N007] fact: Q2 deadline | Edge: part_of (0.5) | Score: 0.3\n\nHOPS REMAINING: 5\nALREADY VISITED: []',
    output: JSON.stringify({
      steps: [
        {
          node_id: 'N002',
          from_edge: 'entry_point',
          finding: 'Health App uses CNN for activity recognition - direct ML-health connection',
          should_continue: true,
          reason: 'Found concrete ML-health link, explore Neural Nets for more detail',
        },
        {
          node_id: 'N003',
          from_edge: 'uses',
          finding: 'Neural net concepts being applied in Health App project',
          should_continue: true,
          reason: 'Career goals may reveal why user is combining these interests',
        },
      ],
      findings: [
        'Health App uses CNN for activity recognition - direct ML-health connection',
        'Neural net concepts being applied in Health App project',
      ],
      should_continue_exploring: true,
      stop_reason: null,
    }),
  },
  {
    input: 'EXPLORATION CONTEXT:\nQuestion: "When did I last talk to David?"\nFindings so far: ["Meeting with investors last month"]\n\nCURRENT NODE:\n[N008] fact: David Chen - "Phone: 555-9876, email: david@email.com"\n\nADJACENT NODES:\n[N009] note: Book recommendations | Edge: mentioned_in (0.3) | Score: 0.15\n\nHOPS REMAINING: 2\nALREADY VISITED: [N007]',
    output: JSON.stringify({
      steps: [
        {
          node_id: 'N008',
          from_edge: 'relates_to',
          finding: "David's contact info exists but no conversation date recorded",
          should_continue: false,
          reason: 'Adjacent node (book recommendations) is unlikely to contain conversation dates',
        },
      ],
      findings: ["David's contact info exists but no conversation date recorded"],
      should_continue_exploring: false,
      stop_reason: 'No remaining paths likely to contain conversation dates with David',
    }),
  },
];

// ============================================================
// P-007: SYNTHESIZE PROMPT (Answer Composition)
// ============================================================

/**
 * P-007 system message.
 * Composes answers from insights discovered during graph exploration.
 *
 * @see storm-027 v1.1 P-007
 * @see storm-003 SynthesizeResult (confidence: number 0-1)
 */
export const NPL_P007_SYSTEM_MESSAGE = `You are composing an answer from a knowledge graph exploration. You have a question and insights discovered while exploring the user's personal knowledge.

ANSWER GUIDELINES:
1. Directly address the question
2. Use ONLY the provided insights (don't invent information)
3. Cite sources naturally: "Based on your note about..." or "You mentioned that..."
4. Acknowledge uncertainty if insights are weak
5. Suggest follow-ups if relevant information might exist elsewhere

CONFIDENCE LEVELS:
- HIGH: Direct answer found, single authoritative source
- MEDIUM: Answer synthesized from multiple sources, or single source with caveats
- LOW: Answer is partial, speculative, or sources are weak

TONE:
- Be direct and helpful
- Don't over-qualify with excessive caveats
- Don't start with "Based on the information provided..."`;

/**
 * P-007 user message template.
 *
 * Placeholders:
 * - {{user_query}} - The user's original question
 * - {{insights_with_sources}} - Insights discovered with node IDs
 * - {{path_visualization}} - Exploration path (Query → Node → Node)
 */
export const NPL_P007_USER_TEMPLATE = `QUESTION: {{user_query}}

INSIGHTS DISCOVERED:
{{insights_with_sources}}

EXPLORATION PATH:
{{path_visualization}}

Compose an answer using ONLY the discovered insights.

Respond with ONLY this JSON:
{
  "answer": "<your response>",
  "sources": [{"node_id": "<id>", "why_used": "<how it contributed>"}],
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "confidence_score": <0.0-1.0>,
  "confidence_reason": "<why this confidence level>",
  "answer_completeness": "complete" | "partial" | "uncertain",
  "follow_up_suggestions": ["<suggestion1>", "<suggestion2>"] | [],
  "information_gaps": ["<what we couldn't find>"] | []
}`;

/**
 * P-007 metadata.
 */
export const NPL_P007_METADATA: NplPromptMetadata = {
  _schemaVersion: 1,
  id: 'P-007',
  name: 'Synthesize (Phase 2)',
  version: '1.1.0',
  lastUpdated: '2026-02-05',
  integratesWith: ['storm-003'],
  testedModels: ['claude-sonnet-4', 'gpt-4o'],
  temperature: 0.3,
  cacheStrategy: 'global',
};

// ============================================================
// P-007 FEW-SHOT EXAMPLES
// ============================================================

/**
 * P-007 few-shot examples.
 *
 * @see storm-027 v1.1 P-007 Few-Shot Examples
 */
export const NPL_P007_EXAMPLES: NplPromptExample[] = [
  {
    input: "QUESTION: \"What's Sarah's phone number?\"\n\nINSIGHTS DISCOVERED:\n- From [N001]: Sarah's phone is 555-1234\n\nEXPLORATION PATH:\nQuery -> N001 (direct match)",
    output: JSON.stringify({
      answer: "Sarah's phone number is 555-1234.",
      sources: [{ node_id: 'N001', why_used: 'Direct phone number fact' }],
      confidence: 'HIGH',
      confidence_score: 0.9,
      confidence_reason: 'Exact match found, single authoritative source',
      answer_completeness: 'complete',
      follow_up_suggestions: [],
      information_gaps: [],
    }),
  },
  {
    input: 'QUESTION: "How does my ML work relate to my health goals?"\n\nINSIGHTS DISCOVERED:\n- From [N002]: Working on Health App that uses ML for fitness predictions\n- From [N004]: Career goal is to work in healthtech\n- From [N003]: Learning neural networks for prediction tasks\n\nEXPLORATION PATH:\nQuery -> N002 (ML + health) -> N004 (career link) -> N003 (skills)',
    output: JSON.stringify({
      answer: "Your ML work connects to your health goals in two ways:\n\n1. **Direct application**: You're working on the Health App project, which uses ML for fitness predictions.\n\n2. **Career trajectory**: Your career notes mention wanting to work in healthtech, and your neural network learning appears to be building relevant skills.\n\nThe Health App is where these interests actively converge.",
      sources: [
        { node_id: 'N002', why_used: 'Concrete ML-health project connection' },
        { node_id: 'N004', why_used: 'Career motivation context' },
        { node_id: 'N003', why_used: 'Relevant skill development' },
      ],
      confidence: 'MEDIUM',
      confidence_score: 0.6,
      confidence_reason: 'Clear connection through Health App, but specific ML techniques used are not documented',
      answer_completeness: 'partial',
      follow_up_suggestions: [
        'What ML techniques are you using in the Health App?',
        'What health metrics does the app predict?',
      ],
      information_gaps: ['Specific ML models or algorithms in use'],
    }),
  },
  {
    input: 'QUESTION: "When did I last talk to David about the investment?"\n\nINSIGHTS DISCOVERED:\n- From [N007]: Meeting with investors last month (no names mentioned)\n- From [N008]: David\'s contact info (phone number only)\n\nEXPLORATION PATH:\nQuery -> N007 (investment) -> N008 (David, weak connection)',
    output: JSON.stringify({
      answer: "I found a meeting with investors last month, but David isn't explicitly mentioned. David is in your contacts but I couldn't find a specific conversation with him about investments.\n\nYou might have discussed it outside your captured notes, or it could be under a different topic.",
      sources: [
        { node_id: 'N007', why_used: 'Only investment meeting found' },
        { node_id: 'N008', why_used: 'David exists but no conversation link' },
      ],
      confidence: 'LOW',
      confidence_score: 0.3,
      confidence_reason: 'No direct evidence of David + investment conversation',
      answer_completeness: 'uncertain',
      follow_up_suggestions: [
        'Do you remember approximately when you talked to David?',
        'Was it in person, email, or phone?',
      ],
      information_gaps: ['Specific conversation with David', 'Date of last interaction'],
    }),
  },
];
