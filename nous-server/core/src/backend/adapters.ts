/**
 * @module @nous/core/backend
 * @description Adapter utilities — schema factories and adapter validation helpers
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-026
 * @storm Brainstorms/Infrastructure/storm-026-backend-infrastructure
 *
 * Provides utility functions for working with adapter types:
 * - Generic schema factories for paginated results
 * - Adapter type validation helpers
 *
 * The adapter interfaces themselves are defined in types.ts.
 * This file provides runtime utilities for working with adapters.
 *
 * @see {@link Specs/Phase-7-Backend-API/storm-026/spec/adapter-interfaces.ts} - Spec
 */

import { z } from 'zod';

// ============================================================
// SCHEMA FACTORIES
// ============================================================

/**
 * Create a Zod schema for PaginatedResult<T> with a given item schema.
 * Used to validate paginated responses from IDatabaseAdapter.
 *
 * @param itemSchema - Zod schema for the items in the result
 * @returns A Zod object schema for PaginatedResult<T>
 *
 * @example
 * ```typescript
 * const NodeResultSchema = createPaginatedResultSchema(z.record(z.unknown()));
 * const result = NodeResultSchema.parse({ items: [...], total: 10, has_more: false });
 * ```
 */
export function createPaginatedResultSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number().int().min(0),
    has_more: z.boolean(),
  });
}
