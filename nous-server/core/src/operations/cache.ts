/**
 * @module @nous/core/operations
 * @description Cache key generation, TTL management, and metrics - storm-034
 * @version 1.0.0
 * @spec Specs/Phase-7-Backend-API/storm-034
 * @storm Brainstorms/Infrastructure/storm-034-backend-operations
 */

import type { CacheType, CacheWarmStrategy } from './constants';
import type { CacheConfig, CacheMetrics } from './types';
import { CACHE_CONFIGS } from './constants';

// ============================================================
// CACHE CONFIGURATION
// ============================================================

/**
 * Get the full cache configuration for a given cache type.
 *
 * @throws If `cacheType` is not found in CACHE_CONFIGS
 */
export function getCacheConfig(cacheType: CacheType): CacheConfig {
  const config = CACHE_CONFIGS[cacheType];
  if (!config) {
    throw new Error(`Unknown cache type: ${cacheType}`);
  }
  return {
    primaryStorage: config.primaryStorage,
    fallbackStorage: config.fallbackStorage,
    ttlSeconds: config.ttlSeconds,
    maxItems: config.maxItems,
    maxBytes: config.maxBytes,
    evictionPolicy: config.evictionPolicy,
    warmStrategy: config.warmStrategy,
  };
}

// ============================================================
// CACHE KEY GENERATION
// ============================================================

/**
 * Generate a cache key for an embedding result.
 * Format: `emb:{length}:{hash}`
 *
 * @param content - The raw content to embed
 * @param hashFn - A hash function (e.g. SHA-256 hex) to produce a digest
 */
export function generateEmbeddingCacheKey(
  content: string,
  hashFn: (s: string) => string,
): string {
  const normalized = normalizeForEmbedding(content);
  const hash = hashFn(normalized);
  return `emb:${normalized.length}:${hash}`;
}

/**
 * Generate a cache key for an LLM response.
 * Format: `llm:{operation}:{model}:{length}:{hash}`
 */
export function generateLLMCacheKey(
  operation: string,
  model: string,
  prompt: string,
  hashFn: (s: string) => string,
): string {
  const hash = hashFn(prompt);
  return `llm:${operation}:${model}:${prompt.length}:${hash}`;
}

/**
 * Generate a cache key for a memory node.
 * Format: `node:{tenantId}:{nodeId}` or `node:{tenantId}:{nodeId}:v{version}`
 */
export function generateNodeCacheKey(
  tenantId: string,
  nodeId: string,
  version?: number,
): string {
  const base = `node:${tenantId}:${nodeId}`;
  if (version !== undefined) {
    return `${base}:v${version}`;
  }
  return base;
}

/**
 * Generate a cache key for a search result.
 * Format: `search:{tenantId}:{queryHash}:{filtersHash}`
 */
export function generateSearchCacheKey(
  tenantId: string,
  query: string,
  filters: Record<string, unknown>,
  hashFn: (s: string) => string,
): string {
  const queryHash = hashFn(query);
  const filtersHash = hashFn(stableStringify(filters));
  return `search:${tenantId}:${queryHash}:${filtersHash}`;
}

/**
 * Generate a cache key for edges connected to a node.
 * Format: `edges:{tenantId}:{nodeId}`
 */
export function generateEdgeCacheKey(tenantId: string, nodeId: string): string {
  return `edges:${tenantId}:${nodeId}`;
}

/**
 * Generate a cache key for a user session.
 * Format: `session:{sessionId}`
 */
export function generateSessionCacheKey(sessionId: string): string {
  return `session:${sessionId}`;
}

// ============================================================
// CONTENT NORMALIZATION
// ============================================================

/**
 * Normalize content for consistent embedding cache key generation.
 *
 * 1. Convert to lowercase
 * 2. Trim leading and trailing whitespace
 * 3. Collapse all consecutive whitespace into a single space
 * 4. Truncate to a maximum of 8000 characters
 */
export function normalizeForEmbedding(content: string): string {
  return content
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 8000);
}

// ============================================================
// TTL AND LIMITS
// ============================================================

/** Get the TTL (time-to-live) in seconds for a given cache type. */
export function getTTLSeconds(cacheType: CacheType): number {
  return getCacheConfig(cacheType).ttlSeconds;
}

/** Get the maximum number of items allowed for a given cache type. */
export function getMaxItems(cacheType: CacheType): number {
  return getCacheConfig(cacheType).maxItems;
}

// ============================================================
// METRICS
// ============================================================

/**
 * Calculate the cache hit rate as a value between 0 and 1.
 * Safely handles zero denominator (returns 0).
 */
export function calculateHitRate(hits: number, misses: number): number {
  const total = hits + misses;
  if (total === 0) {
    return 0;
  }
  return hits / total;
}

/**
 * Determine whether cache eviction should be triggered.
 * Eviction is needed when itemCount >= maxItems.
 */
export function shouldEvict(metrics: CacheMetrics): boolean {
  return metrics.itemCount >= metrics.maxItems;
}

/** Get the warm (pre-population) strategy for a cache type. */
export function selectWarmStrategy(cacheType: CacheType): CacheWarmStrategy {
  return getCacheConfig(cacheType).warmStrategy;
}

/**
 * Create an empty CacheMetrics object with all counters initialized to zero.
 */
export function createEmptyCacheMetrics(cacheType: CacheType): CacheMetrics {
  const config = getCacheConfig(cacheType);
  return {
    cacheType,
    storage: config.primaryStorage,
    hits: 0,
    misses: 0,
    hitRate: 0,
    itemCount: 0,
    maxItems: config.maxItems,
    bytesUsed: 0,
    maxBytes: config.maxBytes ?? 0,
    evictions: 0,
    avgLatencyMs: 0,
    p99LatencyMs: 0,
  };
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Produce a deterministic JSON string from an object by sorting keys.
 */
function stableStringify(obj: Record<string, unknown>): string {
  const sortedKeys = Object.keys(obj).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sorted[key] = obj[key];
  }
  return JSON.stringify(sorted);
}
