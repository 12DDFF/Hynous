/**
 * @module @nous/core/security
 * @description E2E encryption schema, encrypted node structure, client-side search
 * @version 1.0.0
 * @spec Specs/Phase-6-Technical-Services/storm-022
 * @storm Brainstorms/Infrastructure/storm-022-security-auth
 *
 * Encryption field mapping, client-side search configs, and encrypt/decrypt
 * operations for Private tier nodes.
 *
 * @see {@link Specs/Phase-6-Technical-Services/storm-022/spec/encryption.ts} - Spec
 */

import {
  PRIVATE_TIER_NODE_LIMITS,
} from './constants';

import {
  type EncryptionFieldMap,
  type EncryptionResult,
  type DecryptionResult,
  type ClientSearchConfig,
  type LocalSearchResult,
  type HNSWIndex,
  type EncryptedNodeSchema,
  type DerivedKeys,
} from './types';

// ============================================================
// ENCRYPTION FIELD MAP
// ============================================================

/**
 * Concrete field mapping for Private tier encryption.
 * Defines which node fields are encrypted vs. stay plaintext.
 *
 * Design principle: Minimal plaintext. Only fields absolutely required
 * for sync and basic filtering remain unencrypted.
 *
 * @see storm-022 v1 revision Section 2 - SQL schema comments
 * @see storm-011 spec/node-schema.ts - NousNode interface fields
 */
export const ENCRYPTION_FIELD_MAP: EncryptionFieldMap = {
  plaintext: [
    'id',
    'type',
    'version',
    'updated_at',
    'encryption_version',
    'nonce',
    'encryption_tier',
  ],
  encrypted_content: [
    'content.title',
    'content.body',
    'content.summary',
    'content.blocks',
  ],
  encrypted_embedding: [
    'embedding.vector',
  ],
  encrypted_metadata: [
    'temporal.ingestion',
    'temporal.event',
    'temporal.content_times',
    'temporal.reference_patterns',
    'neural.stability',
    'neural.retrievability',
    'neural.last_accessed',
    'neural.access_count',
    'provenance.source',
    'provenance.parent_id',
    'provenance.confidence',
    'state.extraction_depth',
    'state.lifecycle',
    'versioning.lastModified',
    'versioning.lastModifier',
    'versioning.checksum',
  ],
} as const;

// ============================================================
// EXTENDED SQL SCHEMA
// ============================================================

/**
 * Additional SQL columns for encrypted nodes.
 * These extend the storm-017 nodes table which already has
 * encrypted_payload and encryption_tier.
 *
 * @see storm-017 spec/schema.ts - Existing NODES_TABLE
 */
export const ENCRYPTED_NODES_ADDITIONAL_SQL = `
-- Additional columns for storm-022 Private tier encryption
-- (encrypted_payload and encryption_tier already exist from storm-017)

ALTER TABLE nodes ADD COLUMN encrypted_embedding BLOB;
ALTER TABLE nodes ADD COLUMN encryption_version INTEGER DEFAULT 1;
ALTER TABLE nodes ADD COLUMN nonce BLOB;

-- Index on encryption version for key rotation queries
CREATE INDEX IF NOT EXISTS idx_nodes_encryption_version ON nodes(encryption_version)
  WHERE encryption_tier = 'private';
`;

// ============================================================
// CLIENT SEARCH CONFIGS
// ============================================================

/**
 * Default client search configuration for mobile devices.
 */
export const DEFAULT_CLIENT_SEARCH_CONFIG_MOBILE: ClientSearchConfig = {
  hnsw_ef_construction: 200,
  hnsw_ef_search: 50,
  hnsw_m: 16,
  max_nodes: PRIVATE_TIER_NODE_LIMITS.mobile,
  index_in_memory: true,
} as const;

/**
 * Default client search configuration for desktop devices.
 */
export const DEFAULT_CLIENT_SEARCH_CONFIG_DESKTOP: ClientSearchConfig = {
  hnsw_ef_construction: 200,
  hnsw_ef_search: 50,
  hnsw_m: 16,
  max_nodes: PRIVATE_TIER_NODE_LIMITS.desktop,
  index_in_memory: true,
} as const;

// ============================================================
// PERFORMANCE REFERENCE
// ============================================================

/**
 * Client-side search performance reference table.
 *
 * | Node Count | Memory   | Index Build  | Search Latency |
 * |------------|----------|--------------|----------------|
 * | 10K        | ~130 MB  | ~2 seconds   | ~20ms          |
 * | 50K        | ~650 MB  | ~10 seconds  | ~40ms          |
 * | 100K       | ~1.3 GB  | ~20 seconds  | ~60ms          |
 *
 * @see storm-022 v1 revision Section 2 - Performance Limits table
 */
export const PERFORMANCE_REFERENCE = {
  '10k': {
    memory_mb: 130,
    index_build_seconds: 2,
    search_latency_ms: 20,
  },
  '50k': {
    memory_mb: 650,
    index_build_seconds: 10,
    search_latency_ms: 40,
  },
  '100k': {
    memory_mb: 1300,
    index_build_seconds: 20,
    search_latency_ms: 60,
  },
} as const;

// ============================================================
// EXTERNAL SERVICE FUNCTIONS
// ============================================================

/**
 * Encrypts a full node for Private tier storage.
 * Separates content into encrypted_payload and encrypted_embedding.
 * Requires Web Crypto API.
 *
 * @param _node - The plaintext NousNode to encrypt
 * @param _keys - Derived encryption keys (content, embedding, metadata)
 * @returns Encryption result with payload, embedding, nonce, and version
 */
export async function encryptNode(
  _node: unknown,
  _keys: DerivedKeys,
): Promise<EncryptionResult> {
  throw new Error('encryptNode requires Web Crypto API implementation');
}

/**
 * Decrypts an encrypted node back to its component fields.
 * Requires Web Crypto API.
 *
 * @param _encrypted - The encrypted node schema
 * @param _keys - Derived decryption keys
 * @returns Decrypted node fields
 */
export async function decryptNode(
  _encrypted: EncryptedNodeSchema,
  _keys: DerivedKeys,
): Promise<DecryptionResult> {
  throw new Error('decryptNode requires Web Crypto API implementation');
}

/**
 * Encrypts an embedding vector with the embedding key.
 * Requires Web Crypto API.
 *
 * @param _vector - Float32Array embedding
 * @param _key - Embedding encryption key
 * @returns Encrypted embedding bytes
 */
export async function encryptEmbedding(
  _vector: Float32Array,
  _key: CryptoKey,
): Promise<Uint8Array> {
  throw new Error('encryptEmbedding requires Web Crypto API implementation');
}

/**
 * Decrypts an encrypted embedding back to Float32Array.
 * Requires Web Crypto API.
 *
 * @param _encrypted - Encrypted embedding bytes
 * @param _key - Embedding decryption key
 * @returns Decrypted Float32Array
 */
export async function decryptEmbedding(
  _encrypted: Uint8Array,
  _key: CryptoKey,
): Promise<Float32Array> {
  throw new Error('decryptEmbedding requires Web Crypto API implementation');
}

/**
 * Builds an in-memory HNSW index from decrypted embeddings.
 * Requires HNSW library (e.g., hnswlib-node).
 *
 * @param _decryptedEmbeddings - Map of node_id to decrypted Float32Array
 * @param _config - HNSW configuration
 * @returns In-memory HNSW index
 */
export async function buildLocalSearchIndex(
  _decryptedEmbeddings: Map<string, Float32Array>,
  _config: ClientSearchConfig,
): Promise<HNSWIndex> {
  throw new Error('buildLocalSearchIndex requires HNSW library implementation');
}

/**
 * Searches the local HNSW index.
 * Requires HNSW library.
 *
 * @param _index - In-memory HNSW index
 * @param _query - Query embedding vector
 * @param _topK - Number of results to return
 * @returns Search results ordered by similarity
 */
export async function searchLocalIndex(
  _index: HNSWIndex,
  _query: Float32Array,
  _topK: number,
): Promise<LocalSearchResult[]> {
  throw new Error('searchLocalIndex requires HNSW library implementation');
}
