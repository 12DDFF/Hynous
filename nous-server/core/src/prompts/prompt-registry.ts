/**
 * @module @nous/core/prompts
 * @description Prompt registry — aggregates all 13 NPL prompts and provides lookup functions
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-027
 * @storm Brainstorms/Infrastructure/storm-027-prompt-engineering
 *
 * Provides:
 * - nplGetPrompt(id): Look up any prompt by ID
 * - nplGetCacheContent(type): Get representative cache content for storm-015
 * - NPL_PROMPT_REGISTRY: Complete registry of all 13 prompts
 *
 * @see {@link ./constants} - Prompt IDs and configurations
 * @see {@link ./types} - NplPromptTemplate interface
 */

import type { NplPromptId } from './constants';
import { NPL_PROMPT_IDS } from './constants';
import type { NplPromptTemplate } from './types';

// Import all prompt system messages, templates, metadata, and examples
import {
  NPL_P001_SYSTEM_MESSAGE,
  NPL_P001_USER_TEMPLATE,
  NPL_P001_METADATA,
  NPL_P001_EXAMPLES,
  NPL_P002_SYSTEM_MESSAGE,
  NPL_P002_USER_TEMPLATE,
  NPL_P002_METADATA,
  NPL_P002_EXAMPLES,
  NPL_P002C_SYSTEM_MESSAGE,
  NPL_P002C_USER_TEMPLATE,
  NPL_P002C_METADATA,
  NPL_P002C_EXAMPLES,
} from './classification';

import {
  NPL_P003_SYSTEM_MESSAGE,
  NPL_P003_USER_TEMPLATE,
  NPL_P003_METADATA,
  NPL_P003_EXAMPLES,
  NPL_P004_SYSTEM_MESSAGE,
  NPL_P004_USER_TEMPLATE,
  NPL_P004_METADATA,
  NPL_P004_EXAMPLES,
} from './extraction';

import {
  NPL_P005_SYSTEM_MESSAGE,
  NPL_P005_USER_TEMPLATE,
  NPL_P005_METADATA,
  NPL_P005_EXAMPLES,
  NPL_P006_SYSTEM_MESSAGE,
  NPL_P006_USER_TEMPLATE,
  NPL_P006_METADATA,
  NPL_P006_EXAMPLES,
  NPL_P007_SYSTEM_MESSAGE,
  NPL_P007_USER_TEMPLATE,
  NPL_P007_METADATA,
  NPL_P007_EXAMPLES,
} from './cognition';

import {
  NPL_P008_SYSTEM_MESSAGE,
  NPL_P008_METADATA,
  NPL_P008_EXAMPLES,
} from './chat-system';

import {
  NPL_P009_SYSTEM_MESSAGE,
  NPL_P009_USER_TEMPLATE,
  NPL_P009_METADATA,
  NPL_P009_EXAMPLES,
  NPL_P010_SYSTEM_MESSAGE,
  NPL_P010_METADATA,
  NPL_P010_EXAMPLES,
  NPL_P010B_SYSTEM_MESSAGE,
  NPL_P010B_USER_TEMPLATE,
  NPL_P010B_METADATA,
  NPL_P010B_EXAMPLES,
  NPL_P011_SYSTEM_MESSAGE,
  NPL_P011_USER_TEMPLATE,
  NPL_P011_METADATA,
  NPL_P011_EXAMPLES,
} from './operations';

// ============================================================
// PROMPT REGISTRY
// ============================================================

/**
 * Complete registry of all 13 NPL prompts.
 * Each prompt contains: metadata, systemMessage, userTemplate, examples.
 *
 * NOTE: P-008 has no user template — the system message includes
 * {{RETRIEVED_CONTEXT}} and {{CONVERSATION_HISTORY}} placeholders.
 *
 * NOTE: P-010 has no user template — the system message includes
 * all {placeholder} markers inline (storm-009 convention).
 *
 * @see storm-027 spec for complete prompt documentation
 */
export const NPL_PROMPT_REGISTRY: Record<NplPromptId, NplPromptTemplate> = {
  'P-001': {
    metadata: NPL_P001_METADATA,
    systemMessage: NPL_P001_SYSTEM_MESSAGE,
    userTemplate: NPL_P001_USER_TEMPLATE,
    examples: NPL_P001_EXAMPLES,
  },
  'P-002': {
    metadata: NPL_P002_METADATA,
    systemMessage: NPL_P002_SYSTEM_MESSAGE,
    userTemplate: NPL_P002_USER_TEMPLATE,
    examples: NPL_P002_EXAMPLES,
  },
  'P-002C': {
    metadata: NPL_P002C_METADATA,
    systemMessage: NPL_P002C_SYSTEM_MESSAGE,
    userTemplate: NPL_P002C_USER_TEMPLATE,
    examples: NPL_P002C_EXAMPLES,
  },
  'P-003': {
    metadata: NPL_P003_METADATA,
    systemMessage: NPL_P003_SYSTEM_MESSAGE,
    userTemplate: NPL_P003_USER_TEMPLATE,
    examples: NPL_P003_EXAMPLES,
  },
  'P-004': {
    metadata: NPL_P004_METADATA,
    systemMessage: NPL_P004_SYSTEM_MESSAGE,
    userTemplate: NPL_P004_USER_TEMPLATE,
    examples: NPL_P004_EXAMPLES,
  },
  'P-005': {
    metadata: NPL_P005_METADATA,
    systemMessage: NPL_P005_SYSTEM_MESSAGE,
    userTemplate: NPL_P005_USER_TEMPLATE,
    examples: NPL_P005_EXAMPLES,
  },
  'P-006': {
    metadata: NPL_P006_METADATA,
    systemMessage: NPL_P006_SYSTEM_MESSAGE,
    userTemplate: NPL_P006_USER_TEMPLATE,
    examples: NPL_P006_EXAMPLES,
  },
  'P-007': {
    metadata: NPL_P007_METADATA,
    systemMessage: NPL_P007_SYSTEM_MESSAGE,
    userTemplate: NPL_P007_USER_TEMPLATE,
    examples: NPL_P007_EXAMPLES,
  },
  'P-008': {
    metadata: NPL_P008_METADATA,
    systemMessage: NPL_P008_SYSTEM_MESSAGE,
    userTemplate: '{{RETRIEVED_CONTEXT}}\n{{CONVERSATION_HISTORY}}',
    examples: NPL_P008_EXAMPLES,
  },
  'P-009': {
    metadata: NPL_P009_METADATA,
    systemMessage: NPL_P009_SYSTEM_MESSAGE,
    userTemplate: NPL_P009_USER_TEMPLATE,
    examples: NPL_P009_EXAMPLES,
  },
  'P-010': {
    metadata: NPL_P010_METADATA,
    systemMessage: NPL_P010_SYSTEM_MESSAGE,
    userTemplate: NPL_P010_SYSTEM_MESSAGE, // Storm-009 inline format — system IS the template
    examples: NPL_P010_EXAMPLES,
  },
  'P-010B': {
    metadata: NPL_P010B_METADATA,
    systemMessage: NPL_P010B_SYSTEM_MESSAGE,
    userTemplate: NPL_P010B_USER_TEMPLATE,
    examples: NPL_P010B_EXAMPLES,
  },
  'P-011': {
    metadata: NPL_P011_METADATA,
    systemMessage: NPL_P011_SYSTEM_MESSAGE,
    userTemplate: NPL_P011_USER_TEMPLATE,
    examples: NPL_P011_EXAMPLES,
  },
} as const;

// ============================================================
// REGISTRY FUNCTIONS
// ============================================================

/**
 * Get a prompt template by ID.
 *
 * @param id - Prompt ID (e.g., 'P-001')
 * @returns Complete prompt template or undefined if not found
 */
export function nplGetPrompt(id: NplPromptId): NplPromptTemplate {
  return NPL_PROMPT_REGISTRY[id];
}

/**
 * Get all prompt IDs in the registry.
 *
 * @returns Array of all registered prompt IDs
 */
export function nplGetAllPromptIds(): readonly NplPromptId[] {
  return NPL_PROMPT_IDS;
}

/**
 * Get cache content for a storm-015 cache category.
 * Returns the representative system prompt for each cache category.
 *
 * - classifier: P-001 system message (most frequently used classifier)
 * - extractor: P-003 system message (most frequently used extractor)
 * - responder: P-008 system message (largest, explicitly cached)
 *
 * @param type - Cache category from storm-015
 * @returns System prompt content for caching
 *
 * @see storm-015 PROMPT_CACHE_CONFIGS (content "Set by storm-027")
 */
export function nplGetCacheContent(type: 'classifier' | 'extractor' | 'responder'): string {
  switch (type) {
    case 'classifier':
      return NPL_P001_SYSTEM_MESSAGE;
    case 'extractor':
      return NPL_P003_SYSTEM_MESSAGE;
    case 'responder':
      return NPL_P008_SYSTEM_MESSAGE;
  }
}
