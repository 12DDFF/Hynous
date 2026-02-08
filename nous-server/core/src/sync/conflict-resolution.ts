/**
 * @module @nous/core/sync/conflict-resolution
 * @description Conflict detection and resolution for sync
 * @version 1.0.0
 * @spec Brainstorms/Specs/storm-017
 * @storm Brainstorms/Infrastructure/storm-017-infrastructure-architecture
 *
 * Implements smart conflict resolution:
 * - Weak conflicts (different fields changed) -> auto-merge
 * - Strong conflicts (same field changed) -> user resolution
 *
 * @see storm-017 v1.1 - Smart auto-merge conflicts
 * @see storm-033 - Detailed conflict resolution specification
 */

import { z } from 'zod';

// ============================================================
// CONFLICT TYPES
// ============================================================

/**
 * Conflict strength classification.
 */
export const CONFLICT_STRENGTHS = ['weak', 'strong'] as const;
export type ConflictStrength = (typeof CONFLICT_STRENGTHS)[number];

/**
 * Field categories for conflict classification.
 *
 * Different field types have different merge strategies.
 */
export const FIELD_CATEGORIES = [
  'content', // Main content (body, title)
  'metadata', // Access counts, timestamps
  'neural', // Neural properties
  'structural', // Type, lifecycle
  'versioning', // Version numbers
] as const;

export type FieldCategory = (typeof FIELD_CATEGORIES)[number];

/**
 * Maps field names to categories.
 */
export const FIELD_CATEGORY_MAP: Record<string, FieldCategory> = {
  // Content fields - strong conflicts
  content_title: 'content',
  content_body: 'content',
  content_summary: 'content',
  content_blocks: 'content',

  // Metadata fields - weak conflicts, merge additively
  neural_access_count: 'metadata',
  neural_last_accessed: 'metadata',

  // Neural fields - weak conflicts, take max
  neural_stability: 'neural',
  neural_retrievability: 'neural',

  // Structural fields - strong conflicts
  type: 'structural',
  subtype: 'structural',
  state_lifecycle: 'structural',
  state_extraction_depth: 'structural',

  // Versioning - handled specially
  version: 'versioning',
  last_modified: 'versioning',
  last_modifier: 'versioning',
};

// ============================================================
// CONFLICT DETECTION
// ============================================================

/**
 * Detected conflict information.
 */
export interface DetectedConflict {
  /** Node ID with conflict */
  nodeId: string;
  /** Conflict strength */
  strength: ConflictStrength;
  /** Local version number */
  localVersion: number;
  /** Cloud version number */
  cloudVersion: number;
  /** Base version (last common ancestor) */
  baseVersion: number;
  /** Local modification timestamp */
  localModifiedAt: string;
  /** Cloud modification timestamp */
  cloudModifiedAt: string;
  /** Fields that differ between local and cloud */
  fieldsInConflict: string[];
  /** Categories of conflicting fields */
  conflictCategories: FieldCategory[];
  /** Whether this can be auto-resolved */
  canAutoResolve: boolean;
  /** Suggested resolution (if auto-resolvable) */
  suggestedResolution?: ConflictResolution;
}

export const DetectedConflictSchema = z.object({
  nodeId: z.string().min(1),
  strength: z.enum(CONFLICT_STRENGTHS),
  localVersion: z.number().int().positive(),
  cloudVersion: z.number().int().positive(),
  baseVersion: z.number().int().positive(),
  localModifiedAt: z.string().datetime(),
  cloudModifiedAt: z.string().datetime(),
  fieldsInConflict: z.array(z.string()),
  conflictCategories: z.array(z.enum(FIELD_CATEGORIES)),
  canAutoResolve: z.boolean(),
  suggestedResolution: z.any().optional(),
});

// ============================================================
// CONFLICT CLASSIFICATION
// ============================================================

/**
 * Gets the category for a field name.
 */
export function getFieldCategory(fieldName: string): FieldCategory {
  return FIELD_CATEGORY_MAP[fieldName] ?? 'content';
}

/**
 * Gets unique categories from a list of field names.
 */
export function getFieldCategories(fieldNames: string[]): FieldCategory[] {
  const categories = new Set(fieldNames.map(getFieldCategory));
  return Array.from(categories);
}

/**
 * Classifies conflict strength based on changed fields.
 *
 * WEAK CONFLICT (auto-merge):
 * - Metadata-only changes (access_count, last_accessed)
 * - Non-overlapping edits (different fields changed)
 * - Additive changes (both added content, no deletions)
 *
 * STRONG CONFLICT (user resolution):
 * - Same field edited with different values
 * - Content deleted on one side, modified on other
 * - Structural changes (node type changed)
 *
 * @param localChanges - Fields changed locally
 * @param cloudChanges - Fields changed in cloud
 * @returns Conflict strength
 */
export function classifyConflictStrength(
  localChanges: string[],
  cloudChanges: string[]
): ConflictStrength {
  // Find overlapping changes
  const overlap = localChanges.filter((f) => cloudChanges.includes(f));

  if (overlap.length === 0) {
    // No overlapping changes - weak conflict
    return 'weak';
  }

  // Check if all overlapping changes are in metadata category
  const overlapCategories = overlap.map(getFieldCategory);
  const hasNonMetadataOverlap = overlapCategories.some(
    (cat) => cat !== 'metadata' && cat !== 'neural'
  );

  if (hasNonMetadataOverlap) {
    // Content or structural overlap - strong conflict
    return 'strong';
  }

  // Only metadata/neural overlap - weak conflict
  return 'weak';
}

/**
 * Determines if a conflict can be auto-resolved.
 *
 * @param conflict - Detected conflict
 * @returns Whether conflict can be auto-resolved
 */
export function canAutoResolveConflict(conflict: DetectedConflict): boolean {
  if (conflict.strength === 'strong') {
    return false;
  }

  // Weak conflicts with only metadata/neural fields can be auto-resolved
  const hasContentConflict = conflict.conflictCategories.some(
    (cat) => cat === 'content' || cat === 'structural'
  );

  return !hasContentConflict;
}

// ============================================================
// CONFLICT RESOLUTION
// ============================================================

/**
 * Resolution action types.
 */
export const RESOLUTION_ACTIONS = [
  'keep_local',
  'keep_cloud',
  'keep_both',
  'merge_fields',
  'custom',
] as const;

export type ResolutionAction = (typeof RESOLUTION_ACTIONS)[number];

/**
 * Conflict resolution specification.
 */
export interface ConflictResolution {
  /** Resolution action */
  action: ResolutionAction;
  /** For merge_fields: which field takes which value */
  fieldResolutions?: Record<string, 'local' | 'cloud'>;
  /** Resolved version number */
  resolvedVersion: number;
  /** Resolution timestamp */
  resolvedAt: string;
  /** Who resolved (user or auto) */
  resolvedBy: 'user' | 'auto';
  /** Notes about the resolution */
  notes?: string;
}

export const ConflictResolutionSchema = z.object({
  action: z.enum(RESOLUTION_ACTIONS),
  fieldResolutions: z.record(z.enum(['local', 'cloud'])).optional(),
  resolvedVersion: z.number().int().positive(),
  resolvedAt: z.string().datetime(),
  resolvedBy: z.enum(['user', 'auto']),
  notes: z.string().optional(),
});

// ============================================================
// MERGE STRATEGIES
// ============================================================

/**
 * Field merge strategy types.
 */
export const MERGE_STRATEGIES = [
  'take_local',
  'take_cloud',
  'take_latest',
  'take_max',
  'take_min',
  'sum',
  'concatenate',
  'user_choice',
] as const;

export type MergeStrategy = (typeof MERGE_STRATEGIES)[number];

/**
 * Field-specific merge strategies.
 *
 * @see storm-033 - 13 field-level merge strategies
 */
export const FIELD_MERGE_STRATEGIES: Record<string, MergeStrategy> = {
  // Content - user must choose
  content_title: 'user_choice',
  content_body: 'user_choice',
  content_summary: 'user_choice',
  content_blocks: 'user_choice',

  // Metadata - automatic merge
  neural_access_count: 'sum',
  neural_last_accessed: 'take_latest',

  // Neural - take max (higher stability/retrievability preserved)
  neural_stability: 'take_max',
  neural_retrievability: 'take_max',

  // Structural - user must choose
  type: 'user_choice',
  subtype: 'user_choice',
  state_lifecycle: 'take_latest',
  state_extraction_depth: 'user_choice',

  // Provenance
  provenance_confidence: 'take_max',
};

/**
 * Gets the merge strategy for a field.
 */
export function getMergeStrategy(fieldName: string): MergeStrategy {
  return FIELD_MERGE_STRATEGIES[fieldName] ?? 'user_choice';
}

// ============================================================
// AUTO-MERGE IMPLEMENTATION
// ============================================================

/**
 * Auto-merge result for a single field.
 */
export interface FieldMergeResult {
  fieldName: string;
  strategy: MergeStrategy;
  resolvedValue: unknown;
  source: 'local' | 'cloud' | 'merged';
}

/**
 * Auto-merge result.
 */
export interface AutoMergeResult {
  /** Whether merge succeeded */
  success: boolean;
  /** Merged field values */
  mergedFields: FieldMergeResult[];
  /** Fields that couldn't be merged */
  unmergeableFields: string[];
  /** Resulting version number */
  resultVersion: number;
}

/**
 * Applies a merge strategy to merge two values.
 *
 * @param strategy - Merge strategy to use
 * @param localValue - Local value
 * @param cloudValue - Cloud value
 * @param localTimestamp - Local modification time
 * @param cloudTimestamp - Cloud modification time
 * @returns Merged value and source
 * @throws Error if strategy is 'user_choice'
 */
export function applyMergeStrategy(
  strategy: MergeStrategy,
  localValue: unknown,
  cloudValue: unknown,
  localTimestamp: string,
  cloudTimestamp: string
): { value: unknown; source: 'local' | 'cloud' | 'merged' } {
  switch (strategy) {
    case 'take_local':
      return { value: localValue, source: 'local' };

    case 'take_cloud':
      return { value: cloudValue, source: 'cloud' };

    case 'take_latest':
      if (new Date(localTimestamp) >= new Date(cloudTimestamp)) {
        return { value: localValue, source: 'local' };
      }
      return { value: cloudValue, source: 'cloud' };

    case 'take_max':
      if (typeof localValue === 'number' && typeof cloudValue === 'number') {
        return localValue >= cloudValue
          ? { value: localValue, source: 'local' }
          : { value: cloudValue, source: 'cloud' };
      }
      return { value: localValue, source: 'local' };

    case 'take_min':
      if (typeof localValue === 'number' && typeof cloudValue === 'number') {
        return localValue <= cloudValue
          ? { value: localValue, source: 'local' }
          : { value: cloudValue, source: 'cloud' };
      }
      return { value: localValue, source: 'local' };

    case 'sum':
      if (typeof localValue === 'number' && typeof cloudValue === 'number') {
        // For counters, we need base value. Simplified: take max
        return { value: Math.max(localValue, cloudValue), source: 'merged' };
      }
      return { value: localValue, source: 'local' };

    case 'concatenate':
      if (Array.isArray(localValue) && Array.isArray(cloudValue)) {
        // Dedupe by ID if present
        const merged = [...localValue];
        for (const item of cloudValue) {
          const itemWithId = item as { id?: string };
          if (
            !merged.some(
              (m) => (m as { id?: string }).id === itemWithId.id
            )
          ) {
            merged.push(item);
          }
        }
        return { value: merged, source: 'merged' };
      }
      return { value: localValue, source: 'local' };

    case 'user_choice':
    default:
      // Cannot auto-merge - return null to indicate user choice needed
      throw new Error(`Field requires user choice: ${strategy}`);
  }
}

/**
 * Attempts to auto-merge a weak conflict.
 */
export function attemptAutoMerge(
  localData: Record<string, unknown>,
  cloudData: Record<string, unknown>,
  fieldsInConflict: string[],
  localTimestamp: string,
  cloudTimestamp: string,
  baseVersion: number
): AutoMergeResult {
  const mergedFields: FieldMergeResult[] = [];
  const unmergeableFields: string[] = [];

  for (const field of fieldsInConflict) {
    const strategy = getMergeStrategy(field);

    if (strategy === 'user_choice') {
      unmergeableFields.push(field);
      continue;
    }

    try {
      const result = applyMergeStrategy(
        strategy,
        localData[field],
        cloudData[field],
        localTimestamp,
        cloudTimestamp
      );

      mergedFields.push({
        fieldName: field,
        strategy,
        resolvedValue: result.value,
        source: result.source,
      });
    } catch {
      unmergeableFields.push(field);
    }
  }

  return {
    success: unmergeableFields.length === 0,
    mergedFields,
    unmergeableFields,
    resultVersion: baseVersion + 1,
  };
}

// ============================================================
// CONFLICT RESOLVER INTERFACE
// ============================================================

/**
 * Conflict resolver interface.
 */
export interface ConflictResolver {
  /**
   * Detects conflicts between local and cloud versions.
   *
   * @param nodeId - Node to check
   * @param localData - Local node data
   * @param cloudData - Cloud node data
   * @returns Detected conflict or null if no conflict
   */
  detectConflict(
    nodeId: string,
    localData: Record<string, unknown>,
    cloudData: Record<string, unknown>
  ): DetectedConflict | null;

  /**
   * Attempts auto-merge for a weak conflict.
   *
   * @param conflict - Detected conflict
   * @param localData - Full local node data
   * @param cloudData - Full cloud node data
   * @returns Auto-merge result
   */
  attemptAutoMerge(
    conflict: DetectedConflict,
    localData: Record<string, unknown>,
    cloudData: Record<string, unknown>
  ): AutoMergeResult;

  /**
   * Resolves a conflict with user choice.
   *
   * @param conflict - Detected conflict
   * @param resolution - User's resolution choice
   * @returns Resolution result
   */
  resolveConflict(
    conflict: DetectedConflict,
    resolution: ConflictResolution
  ): Promise<void>;
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validates a detected conflict.
 */
export function validateDetectedConflict(
  conflict: unknown
): conflict is DetectedConflict {
  return DetectedConflictSchema.safeParse(conflict).success;
}

/**
 * Validates a conflict resolution.
 */
export function validateConflictResolution(
  resolution: unknown
): resolution is ConflictResolution {
  return ConflictResolutionSchema.safeParse(resolution).success;
}
