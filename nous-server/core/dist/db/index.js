import { z } from 'zod';

// src/db/config.ts
var PRIVACY_TIERS = ["standard", "private"];
z.enum(PRIVACY_TIERS);
var AUTH_PROVIDERS = ["clerk"];
z.enum(AUTH_PROVIDERS);
var AUTH_METHODS = ["apple", "google", "email_password"];
z.enum(AUTH_METHODS);
var PLATFORMS = ["ios", "android", "macos", "windows"];
z.enum(PLATFORMS);
var OFFLINE_STATES = [
  "online",
  "short_offline",
  "medium_offline",
  "long_offline",
  "reauth_required"
];
z.enum(OFFLINE_STATES);
var CONSENT_SCOPES = [
  "per_message",
  "per_conversation",
  "time_based",
  "topic_based"
];
z.enum(CONSENT_SCOPES);
var CONSENT_DURATIONS = ["1h", "24h", "7d"];
z.enum(CONSENT_DURATIONS);
var CONSENT_REVOCATION_SCOPES = [
  "this_conversation",
  "all_active",
  "everything"
];
z.enum(CONSENT_REVOCATION_SCOPES);
var KEY_PURPOSES = ["content", "embedding", "metadata"];
z.enum(KEY_PURPOSES);
var KEY_VERSION_STATUSES = ["active", "rotating", "deprecated", "expired"];
z.enum(KEY_VERSION_STATUSES);
var KEY_ROTATION_TRIGGERS = [
  "passkey_change",
  "scheduled",
  "security_incident",
  "recovery_used"
];
z.enum(KEY_ROTATION_TRIGGERS);
var ROTATION_PHASES = ["generating", "reencrypting", "verifying", "completing"];
z.enum(ROTATION_PHASES);
var ROTATION_EVENT_TYPES = [
  "rotation:started",
  "rotation:progress",
  "rotation:paused",
  "rotation:resumed",
  "rotation:completed",
  "rotation:failed"
];
z.enum(ROTATION_EVENT_TYPES);
var RECOVERY_METHODS = [
  "multi_device",
  "recovery_code",
  "grace_period"
];
z.enum(RECOVERY_METHODS);
var RECOVERY_REMINDER_TYPES = ["initial", "periodic", "new_device"];
z.enum(RECOVERY_REMINDER_TYPES);
var EXPORT_COMPLIANCE_STATUSES = [
  "exempt",
  "requires_documentation",
  "excluded"
];
z.enum(EXPORT_COMPLIANCE_STATUSES);
var DESKTOP_AUTH_STEPS = [
  "idle",
  "browser_opened",
  "waiting_callback",
  "processing_token",
  "complete",
  "error"
];
z.enum(DESKTOP_AUTH_STEPS);
var TIER_MIGRATION_STATUSES = [
  "pending",
  "key_setup",
  "migrating",
  "verifying",
  "complete",
  "failed"
];
z.enum(TIER_MIGRATION_STATUSES);
var CONSENT_EVENT_TYPES = [
  "consent:requested",
  "consent:granted",
  "consent:declined",
  "consent:revoked",
  "consent:expired"
];
z.enum(CONSENT_EVENT_TYPES);
var PASSKEY_PLATFORMS = ["apple", "google", "microsoft"];
z.enum(PASSKEY_PLATFORMS);
var RECOVERY_SETUP_STEPS = [
  "generating",
  "displaying",
  "verifying",
  "complete"
];
z.enum(RECOVERY_SETUP_STEPS);
var API_KEY_TYPES = ["platform", "byok"];
z.enum(API_KEY_TYPES);
var API_CALL_FLOWS = ["proxied", "direct"];
z.enum(API_CALL_FLOWS);
var BYOK_ENCRYPTION_METHODS = ["server_side", "user_key"];
z.enum(BYOK_ENCRYPTION_METHODS);
var MFA_OPTIONS = ["totp", "sms", "passkey"];
z.enum(MFA_OPTIONS);
var SIGN_IN_IMPLEMENTATIONS = ["native", "rest_api", "oauth", "clerk_ui", "clerk_web"];
z.enum(SIGN_IN_IMPLEMENTATIONS);
var OFFLINE_FUNCTIONALITY_LEVELS = [
  "full",
  "read_write_queued",
  "read_only",
  "local_only"
];
z.enum(OFFLINE_FUNCTIONALITY_LEVELS);
var OFFLINE_SYNC_BEHAVIORS = [
  "realtime",
  "queued",
  "paused",
  "none"
];
z.enum(OFFLINE_SYNC_BEHAVIORS);
var LLM_PROVIDERS = ["openai", "anthropic", "google"];
z.enum(LLM_PROVIDERS);

// src/db/config.ts
var DB_DEFAULTS = {
  /** OpenAI embedding dimensions */
  vectorDimensions: 1536,
  /** DiskANN index parameter */
  maxNeighbors: 50,
  /** Default sync batch size */
  syncBatchSize: 100,
  /** Current schema version */
  schemaVersion: 2,
  /** Default sync interval in milliseconds */
  syncIntervalMs: 6e4,
  /** Default connection timeout */
  connectionTimeoutMs: 1e4,
  /** Max retry attempts */
  maxRetries: 3,
  /** Base retry delay */
  retryDelayMs: 1e3
};
var DATABASE_MODES = ["local", "cloud", "replica"];
var SYNC_MODES = ["auto", "manual", "disabled"];
var TursoConfigSchema = z.object({
  url: z.string().min(1),
  authToken: z.string().optional(),
  syncUrl: z.string().url().optional(),
  syncIntervalMs: z.number().int().positive().optional(),
  encryptionKey: z.string().optional()
});
var DatabaseOptionsSchema = z.object({
  mode: z.enum(DATABASE_MODES),
  enableWAL: z.boolean(),
  connectionTimeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().min(0),
  retryDelayMs: z.number().int().positive(),
  vectorDimensions: z.number().int().positive(),
  maxNeighbors: z.number().int().positive()
});
function createDefaultDatabaseOptions() {
  return {
    mode: "replica",
    enableWAL: true,
    connectionTimeoutMs: DB_DEFAULTS.connectionTimeoutMs,
    maxRetries: DB_DEFAULTS.maxRetries,
    retryDelayMs: DB_DEFAULTS.retryDelayMs,
    vectorDimensions: DB_DEFAULTS.vectorDimensions,
    maxNeighbors: DB_DEFAULTS.maxNeighbors
  };
}
var SyncConfigSchema = z.object({
  mode: z.enum(SYNC_MODES),
  minIntervalMs: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  wifiOnly: z.boolean(),
  chargingOnly: z.boolean(),
  backgroundSync: z.boolean(),
  maxRetries: z.number().int().min(0)
});
function createDefaultSyncConfig() {
  return {
    mode: "auto",
    minIntervalMs: DB_DEFAULTS.syncIntervalMs,
    batchSize: DB_DEFAULTS.syncBatchSize,
    wifiOnly: false,
    chargingOnly: false,
    backgroundSync: true,
    maxRetries: DB_DEFAULTS.maxRetries
  };
}
var TenantConfigSchema = z.object({
  tenantId: z.string().min(1),
  privacyTier: z.enum(PRIVACY_TIERS),
  databaseUrl: z.string().min(1),
  authToken: z.string().min(1),
  storageQuotaBytes: z.number().int().positive(),
  createdAt: z.string().datetime()
});
var InfrastructureConfigSchema = z.object({
  turso: TursoConfigSchema,
  database: DatabaseOptionsSchema,
  sync: SyncConfigSchema
});
function createDefaultInfrastructureConfig(tursoConfig) {
  return {
    turso: tursoConfig,
    database: createDefaultDatabaseOptions(),
    sync: createDefaultSyncConfig()
  };
}
function validateTursoConfig(config) {
  return TursoConfigSchema.safeParse(config).success;
}
function validateDatabaseOptions(options) {
  return DatabaseOptionsSchema.safeParse(options).success;
}
function validateSyncConfig(config) {
  return SyncConfigSchema.safeParse(config).success;
}
function validateInfrastructureConfig(config) {
  return InfrastructureConfigSchema.safeParse(config).success;
}

// src/db/schema.ts
var NODES_TABLE = `
CREATE TABLE IF NOT EXISTS nodes (
  -- Identity
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT,

  -- Content (JSON encoded)
  content_title TEXT,
  content_summary TEXT,
  content_body TEXT,
  content_blocks TEXT,  -- JSON array of Block[]

  -- Vector embedding for semantic search
  embedding F32_BLOB(${DB_DEFAULTS.vectorDimensions}),

  -- Neural properties
  neural_stability REAL DEFAULT 0.5,
  neural_retrievability REAL DEFAULT 0.5,
  neural_access_count INTEGER DEFAULT 0,
  neural_last_accessed TEXT,

  -- State
  state_lifecycle TEXT DEFAULT 'active',
  state_extraction_depth TEXT DEFAULT 'core',

  -- Provenance
  provenance_source TEXT,
  provenance_created_at TEXT NOT NULL,
  provenance_confidence REAL DEFAULT 1.0,

  -- Storage layer
  layer TEXT NOT NULL DEFAULT 'semantic',

  -- Sync metadata
  version INTEGER DEFAULT 1,
  last_modified TEXT NOT NULL,
  last_modifier TEXT,
  sync_status TEXT DEFAULT 'synced',

  -- E2E encryption (for private tier)
  encrypted_payload TEXT,
  encryption_tier TEXT DEFAULT 'standard',

  -- Indexes on created_at for temporal queries
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
var NODES_INDEXES = `
-- Vector similarity search index (DiskANN)
CREATE INDEX IF NOT EXISTS idx_nodes_embedding
ON nodes (libsql_vector_idx(embedding, 'metric=cosine', 'max_neighbors=${DB_DEFAULTS.maxNeighbors}'));

-- Type and subtype for filtering
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes (type);
CREATE INDEX IF NOT EXISTS idx_nodes_subtype ON nodes (subtype);

-- Layer routing
CREATE INDEX IF NOT EXISTS idx_nodes_layer ON nodes (layer);

-- Temporal queries
CREATE INDEX IF NOT EXISTS idx_nodes_created_at ON nodes (created_at);
CREATE INDEX IF NOT EXISTS idx_nodes_last_modified ON nodes (last_modified);

-- Sync status
CREATE INDEX IF NOT EXISTS idx_nodes_sync_status ON nodes (sync_status);

-- Neural properties for retrieval scoring
CREATE INDEX IF NOT EXISTS idx_nodes_stability ON nodes (neural_stability);
CREATE INDEX IF NOT EXISTS idx_nodes_retrievability ON nodes (neural_retrievability);
`;
var EDGES_TABLE = `
CREATE TABLE IF NOT EXISTS edges (
  -- Identity
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,

  -- Relationship
  source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,

  -- Neural properties
  neural_weight REAL DEFAULT 1.0,
  neural_stability REAL DEFAULT 0.5,
  neural_last_activated TEXT,

  -- Metadata
  bidirectional INTEGER DEFAULT 0,

  -- Sync
  version INTEGER DEFAULT 1,
  last_modified TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
var EDGES_INDEXES = `
-- Efficient traversal
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges (source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges (target_id);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges (type);

-- Bidirectional lookup
CREATE INDEX IF NOT EXISTS idx_edges_bidirectional ON edges (source_id, target_id);

-- Weight for relevance
CREATE INDEX IF NOT EXISTS idx_edges_weight ON edges (neural_weight);
`;
var EPISODES_TABLE = `
CREATE TABLE IF NOT EXISTS episodes (
  -- Identity
  id TEXT PRIMARY KEY NOT NULL,

  -- Content
  content TEXT NOT NULL,
  summary TEXT,

  -- Temporal bounds
  start_time TEXT NOT NULL,
  end_time TEXT,

  -- TPS Confidence Factors
  tps_temporal_confidence REAL DEFAULT 0.5,
  tps_parsing_method TEXT,
  tps_source_reliability REAL DEFAULT 0.5,

  -- References to nodes created from this episode
  node_refs TEXT,  -- JSON array of node IDs

  -- Source context
  source_type TEXT,
  source_id TEXT,

  -- Sync
  version INTEGER DEFAULT 1,
  last_modified TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
var EPISODES_INDEXES = `
-- Temporal range queries
CREATE INDEX IF NOT EXISTS idx_episodes_start_time ON episodes (start_time);
CREATE INDEX IF NOT EXISTS idx_episodes_end_time ON episodes (end_time);

-- Source lookup
CREATE INDEX IF NOT EXISTS idx_episodes_source ON episodes (source_type, source_id);
`;
var SYNC_METADATA_TABLE = `
CREATE TABLE IF NOT EXISTS sync_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
var USER_SETTINGS_TABLE = `
CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
var EDIT_HISTORY_TABLE = `
CREATE TABLE IF NOT EXISTS edit_history (
  id TEXT PRIMARY KEY NOT NULL,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,  -- 'create' | 'update' | 'delete'
  before_state TEXT,  -- JSON snapshot before edit
  after_state TEXT,   -- JSON snapshot after edit
  editor_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
var EDIT_HISTORY_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_edit_history_node ON edit_history (node_id);
CREATE INDEX IF NOT EXISTS idx_edit_history_created ON edit_history (created_at);
`;
var LOCAL_CACHE_TABLE = `
CREATE TABLE IF NOT EXISTS local_cache (
  node_id TEXT PRIMARY KEY NOT NULL,
  cached_at TEXT NOT NULL,
  last_accessed TEXT NOT NULL,
  access_count INTEGER DEFAULT 1,
  size_bytes INTEGER NOT NULL
);
`;
var LOCAL_CACHE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_local_cache_last_accessed ON local_cache (last_accessed);
CREATE INDEX IF NOT EXISTS idx_local_cache_access_count ON local_cache (access_count);
`;
var SCHEMA_VERSION_TABLE = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT
);
`;
var FULL_SCHEMA = [
  NODES_TABLE,
  NODES_INDEXES,
  EDGES_TABLE,
  EDGES_INDEXES,
  EPISODES_TABLE,
  EPISODES_INDEXES,
  SYNC_METADATA_TABLE,
  USER_SETTINGS_TABLE,
  EDIT_HISTORY_TABLE,
  EDIT_HISTORY_INDEXES,
  LOCAL_CACHE_TABLE,
  LOCAL_CACHE_INDEXES,
  SCHEMA_VERSION_TABLE
];
var QUERIES = {
  /**
   * Vector similarity search query.
   * Uses cosine distance via DiskANN index.
   */
  vectorSearch: `
    SELECT
      id,
      type,
      content_title,
      content_summary,
      vector_distance_cos(embedding, ?) as distance
    FROM nodes
    WHERE embedding IS NOT NULL
      AND layer = ?
    ORDER BY distance ASC
    LIMIT ?
  `,
  /**
   * Get node by ID.
   */
  getNodeById: `
    SELECT * FROM nodes WHERE id = ?
  `,
  /**
   * Get edges for a node (both directions).
   */
  getEdgesForNode: `
    SELECT * FROM edges
    WHERE source_id = ? OR target_id = ?
  `,
  /**
   * Get outgoing edges from a node.
   */
  getOutgoingEdges: `
    SELECT * FROM edges WHERE source_id = ?
  `,
  /**
   * Get incoming edges to a node.
   */
  getIncomingEdges: `
    SELECT * FROM edges WHERE target_id = ?
  `,
  /**
   * Get episodes in time range.
   */
  getEpisodesInRange: `
    SELECT * FROM episodes
    WHERE start_time >= ? AND (end_time IS NULL OR end_time <= ?)
    ORDER BY start_time ASC
  `,
  /**
   * Get nodes with sync conflicts.
   */
  getSyncConflicts: `
    SELECT * FROM nodes WHERE sync_status = 'conflict'
  `,
  /**
   * Get unsynced changes.
   */
  getUnsyncedChanges: `
    SELECT * FROM nodes WHERE sync_status = 'pending'
  `,
  /**
   * Insert new node.
   */
  insertNode: `
    INSERT INTO nodes (
      id, type, subtype,
      content_title, content_summary, content_body, content_blocks,
      embedding,
      neural_stability, neural_retrievability, neural_access_count,
      state_lifecycle, state_extraction_depth,
      provenance_source, provenance_created_at, provenance_confidence,
      layer, version, last_modified, last_modifier
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  /**
   * Insert new episode.
   */
  insertEpisode: `
    INSERT INTO episodes (
      id, content, summary,
      start_time, end_time,
      tps_temporal_confidence, tps_parsing_method, tps_source_reliability,
      node_refs, source_type, source_id,
      version, last_modified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  /**
   * Update node sync status.
   */
  updateSyncStatus: `
    UPDATE nodes SET sync_status = ?, last_modified = ? WHERE id = ?
  `,
  /**
   * Get schema version.
   */
  getSchemaVersion: `
    SELECT MAX(version) as version FROM schema_version
  `,
  /**
   * Insert schema version.
   */
  insertSchemaVersion: `
    INSERT INTO schema_version (version, description) VALUES (?, ?)
  `
};
function getTableStatements() {
  return [
    NODES_TABLE,
    EDGES_TABLE,
    EPISODES_TABLE,
    SYNC_METADATA_TABLE,
    USER_SETTINGS_TABLE,
    EDIT_HISTORY_TABLE,
    LOCAL_CACHE_TABLE,
    SCHEMA_VERSION_TABLE
  ];
}
function getIndexStatements() {
  return [
    NODES_INDEXES,
    EDGES_INDEXES,
    EPISODES_INDEXES,
    EDIT_HISTORY_INDEXES,
    LOCAL_CACHE_INDEXES
  ];
}
function getDropStatements() {
  return [
    "DROP TABLE IF EXISTS edit_history",
    "DROP TABLE IF EXISTS local_cache",
    "DROP TABLE IF EXISTS edges",
    "DROP TABLE IF EXISTS episodes",
    "DROP TABLE IF EXISTS nodes",
    "DROP TABLE IF EXISTS sync_metadata",
    "DROP TABLE IF EXISTS user_settings",
    "DROP TABLE IF EXISTS schema_version"
  ];
}
var QueryResultSchema = z.object({
  rows: z.array(z.record(z.unknown())),
  rowsAffected: z.number().int().min(0),
  lastInsertRowid: z.bigint().optional()
});
var VectorSearchOptionsSchema = z.object({
  embedding: z.instanceof(Float32Array),
  limit: z.number().int().positive().max(1e3),
  minScore: z.number().min(0).max(1).optional(),
  layer: z.enum(["semantic", "episode", "archive"]).optional(),
  filters: z.record(z.unknown()).optional(),
  includeDistance: z.boolean().optional()
});
function createRowTransformer(transform) {
  return transform;
}
var DB_ERROR_CODES = [
  "CONNECTION_FAILED",
  "QUERY_FAILED",
  "TRANSACTION_FAILED",
  "SYNC_FAILED",
  "MIGRATION_FAILED",
  "TIMEOUT",
  "CONFLICT"
];
var DatabaseError = class extends Error {
  constructor(code, message, cause) {
    super(message);
    this.code = code;
    this.cause = cause;
    this.name = "DatabaseError";
  }
};
function validateVectorSearchOptions(options) {
  return VectorSearchOptionsSchema.safeParse(options).success;
}

// src/db/turso-adapter.ts
function transformTursoResult(tursoResult, transformer) {
  return {
    rows: transformer ? tursoResult.rows.map(transformer) : tursoResult.rows,
    rowsAffected: tursoResult.rowsAffected,
    lastInsertRowid: tursoResult.lastInsertRowid
  };
}
function buildVectorSearchQuery(options) {
  const params = [options.embedding];
  const conditions = ["embedding IS NOT NULL"];
  if (options.layer) {
    conditions.push("layer = ?");
    params.push(options.layer);
  }
  if (options.filters) {
    for (const [key, value] of Object.entries(options.filters)) {
      if (value !== void 0) {
        conditions.push(`${key} = ?`);
        params.push(value);
      }
    }
  }
  params.push(options.limit);
  const sql = `
    SELECT
      id,
      type,
      content_title,
      content_summary,
      vector_distance_cos(embedding, ?) as distance
    FROM nodes
    WHERE ${conditions.join(" AND ")}
    ORDER BY distance ASC
    LIMIT ?
  `;
  return [sql.trim(), params];
}
function transformVectorSearchResult(row) {
  const distance = row["distance"];
  return {
    nodeId: row["id"],
    type: row["type"],
    title: row["content_title"],
    summary: row["content_summary"],
    distance,
    score: 1 - distance / 2
    // Convert distance to similarity score
  };
}
function calculateSyncStats(startTime, framesTotal, framesSynced, bytesTransferred) {
  return {
    framesTotal,
    framesSynced,
    bytesTransferred,
    durationMs: Date.now() - startTime
  };
}
function createSuccessSyncResult(stats) {
  return {
    success: true,
    framesSynced: stats.framesSynced,
    currentFrame: stats.framesTotal,
    durationMs: stats.durationMs,
    conflictsDetected: 0,
    conflictsAutoResolved: 0
  };
}
function createFailedSyncResult(error, durationMs) {
  return {
    success: false,
    framesSynced: 0,
    currentFrame: 0,
    durationMs,
    error,
    conflictsDetected: 0,
    conflictsAutoResolved: 0
  };
}
function parseDatabaseUrl(url) {
  if (url.startsWith("file:")) {
    return "local";
  }
  if (url.startsWith("libsql://") || url.startsWith("https://")) {
    return "cloud";
  }
  return "replica";
}
function isValidTursoUrl(url) {
  try {
    if (url.startsWith("file:")) {
      return true;
    }
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
var DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1e3,
  maxDelayMs: 3e4
};
function calculateBackoffDelay(attempt, config = DEFAULT_RETRY_CONFIG) {
  const delay = config.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, config.maxDelayMs);
}
async function retryWithBackoff(operation, config = DEFAULT_RETRY_CONFIG) {
  let lastError;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < config.maxRetries) {
        const delay = calculateBackoffDelay(attempt, config);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
function toFloat32Array(embedding) {
  return new Float32Array(embedding);
}
function fromFloat32Array(buffer) {
  return Array.from(buffer);
}
function validateEmbeddingDimensions(embedding, expectedDimensions) {
  return embedding.length === expectedDimensions;
}
function getLayerForQuery(layer) {
  return layer ?? "semantic";
}

export { DATABASE_MODES, DB_DEFAULTS, DB_ERROR_CODES, DEFAULT_RETRY_CONFIG, DatabaseError, DatabaseOptionsSchema, EDGES_INDEXES, EDGES_TABLE, EDIT_HISTORY_INDEXES, EDIT_HISTORY_TABLE, EPISODES_INDEXES, EPISODES_TABLE, FULL_SCHEMA, InfrastructureConfigSchema, LOCAL_CACHE_INDEXES, LOCAL_CACHE_TABLE, NODES_INDEXES, NODES_TABLE, QUERIES, QueryResultSchema, SCHEMA_VERSION_TABLE, SYNC_METADATA_TABLE, SYNC_MODES, SyncConfigSchema, TenantConfigSchema, TursoConfigSchema, USER_SETTINGS_TABLE, VectorSearchOptionsSchema, buildVectorSearchQuery, calculateBackoffDelay, calculateSyncStats, createDefaultDatabaseOptions, createDefaultInfrastructureConfig, createDefaultSyncConfig, createFailedSyncResult, createRowTransformer, createSuccessSyncResult, fromFloat32Array, getDropStatements, getIndexStatements, getLayerForQuery, getTableStatements, isValidTursoUrl, parseDatabaseUrl, retryWithBackoff, toFloat32Array, transformTursoResult, transformVectorSearchResult, validateDatabaseOptions, validateEmbeddingDimensions, validateInfrastructureConfig, validateSyncConfig, validateTursoConfig, validateVectorSearchOptions };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map