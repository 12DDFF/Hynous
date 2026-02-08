/**
 * @module @nous/core/security
 * @description Two-tier privacy model: definitions, comparison, tier migration
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * Simplified two-tier privacy model (Standard vs Private).
 * Key insight: Don't offer "partial" encryption. Either data is
 * protected (Private) or it's convenient (Standard).
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/spec/privacy-tiers.ts} - Spec
 */

import {
  type PrivacyTier,
  MIGRATION_RATE_MS_PER_1K_NODES,
} from './constants';

import {
  type TierDefinition,
  type TierComparison,
  type TierMigrationRequest,
  type TierMigrationState,
} from './types';

// ============================================================
// TIER DEFINITIONS
// ============================================================

/**
 * Complete tier definitions from brainstorm.
 *
 * @see storm-022 v1 revision Section 2 - Tier 1: Standard, Tier 2: Private
 */
export const TIER_DEFINITIONS: Record<PrivacyTier, TierDefinition> = {
  standard: {
    tier: 'standard',
    name: 'Standard',
    description: 'Server-managed security with full cloud features. Your data is encrypted at rest and in transit.',
    target_user: 'Users who prioritize convenience over maximum privacy. Trust Nous with their data (but not random attackers).',
    search: 'cloud',
    llm_access: 'direct',
    key_management: 'none',
    data_protection: [
      'Data in transit: TLS 1.3 + certificate pinning',
      'Data at rest: Turso built-in encryption (AES-256)',
      'Separation: Database-per-tenant (your data isolated)',
    ],
    data_exposure: [
      'Nous can technically access your data (for support, debugging)',
      'Subpoena could compel disclosure',
      'Server-side breach could expose plaintext',
    ],
  },
  private: {
    tier: 'private',
    name: 'Private',
    description: 'Full end-to-end encryption. Content and embeddings encrypted client-side. Nous cannot access your data.',
    target_user: 'Journalists, activists, privacy advocates. Users who don\'t want ANYONE to access their data. Willing to accept feature limitations.',
    search: 'client_only',
    llm_access: 'explicit_consent',
    key_management: 'passkey_derived',
    data_protection: [
      'Content: AES-256-GCM encrypted (client-side)',
      'Embeddings: AES-256-GCM encrypted (client-side)',
      'Metadata: Type/ID plaintext (for sync), everything else encrypted',
      'Nous CANNOT access your data - we literally don\'t have the keys',
    ],
    data_exposure: [
      'All search is local (must decrypt to search)',
      'LLM features require explicit consent per-query',
      'Larger devices needed (100MB+ for index)',
      'You can lose your data if you lose keys',
    ],
  },
} as const;

// ============================================================
// TIER COMPARISON TABLE
// ============================================================

/**
 * Feature comparison between tiers (for UI display).
 *
 * @see storm-022 v1 revision Section 2 - Updated Architecture Overview table
 */
export const TIER_COMPARISON_TABLE: TierComparison[] = [
  {
    feature: 'Search',
    standard: 'Full cloud (HNSW + BM25)',
    private_tier: 'Client-side only',
  },
  {
    feature: 'LLM Features',
    standard: 'Direct, seamless',
    private_tier: 'Explicit consent required',
  },
  {
    feature: 'Key Management',
    standard: 'None (server-managed)',
    private_tier: 'Passkey-derived master key',
  },
  {
    feature: 'Data Accessible To',
    standard: 'Nous (for support), law enforcement (with subpoena)',
    private_tier: 'Only you (with your keys)',
  },
  {
    feature: 'Recovery Options',
    standard: 'Email, password reset',
    private_tier: 'Recovery code only (after 7-day grace)',
  },
  {
    feature: 'Offline Experience',
    standard: 'Read-only when offline, sync when back',
    private_tier: 'Full offline (passkey unlock is local)',
  },
  {
    feature: 'Device Requirements',
    standard: 'Any',
    private_tier: '100MB+ for search index',
  },
  {
    feature: 'Export Compliance',
    standard: 'HTTPS exempt, no extra docs',
    private_tier: 'ECCN 5D992, requires documentation',
  },
] as const;

// ============================================================
// PURE FUNCTIONS
// ============================================================

/**
 * Gets the complete tier definition.
 *
 * @param tier - Privacy tier
 * @returns Complete tier definition
 */
export function getTierDefinition(tier: PrivacyTier): TierDefinition {
  return TIER_DEFINITIONS[tier];
}

/**
 * Checks if migration between two tiers is possible.
 * Both directions are valid: standard -> private and private -> standard.
 * Migration from a tier to itself is not valid.
 *
 * @param from - Current tier
 * @param to - Target tier
 * @returns True if migration is possible
 */
export function canMigrateTier(from: PrivacyTier, to: PrivacyTier): boolean {
  return from !== to;
}

/**
 * Estimates migration time in milliseconds based on node count.
 * Uses MIGRATION_RATE_MS_PER_1K_NODES (~60s per 1K nodes).
 *
 * @param node_count - Total number of nodes to migrate
 * @returns Estimated time in milliseconds
 *
 * @see storm-022 v1 revision Section 4 - "Duration: ~1 minute per 1K nodes"
 */
export function estimateMigrationTime(node_count: number): number {
  return Math.ceil(node_count / 1000) * MIGRATION_RATE_MS_PER_1K_NODES;
}

// ============================================================
// EXTERNAL SERVICE FUNCTIONS
// ============================================================

/**
 * Initiates a tier migration. Creates the migration state
 * and begins the background process.
 * Requires server-side migration state tracking and encryption services.
 *
 * @param _request - Migration request
 * @returns Initial migration state
 */
export async function startTierMigration(
  _request: TierMigrationRequest,
): Promise<TierMigrationState> {
  throw new Error('startTierMigration requires server-side migration state and encryption services');
}

/**
 * Gets current migration progress for a user.
 * Returns null if no migration is in progress.
 * Requires server-side migration state lookup.
 *
 * @param _user_id - User ID
 * @returns Current migration state or null
 */
export async function getTierMigrationProgress(
  _user_id: string,
): Promise<TierMigrationState | null> {
  throw new Error('getTierMigrationProgress requires server-side migration state lookup');
}
