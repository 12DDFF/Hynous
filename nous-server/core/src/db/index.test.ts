/**
 * @module @nous/core/db
 * @description Tests for database infrastructure
 */

import { describe, it, expect } from 'vitest';
import {
  // Config
  DB_DEFAULTS,
  DATABASE_MODES,
  SYNC_MODES,
  PRIVACY_TIERS,
  createDefaultDatabaseOptions,
  createDefaultSyncConfig,
  createDefaultInfrastructureConfig,
  validateTursoConfig,
  validateDatabaseOptions,
  validateSyncConfig,
  validateInfrastructureConfig,
  type TursoConfig,
  type DatabaseOptions,
  type SyncConfig,
  type InfrastructureConfig,

  // Schema
  NODES_TABLE,
  EDGES_TABLE,
  EPISODES_TABLE,
  FULL_SCHEMA,
  QUERIES,
  getTableStatements,
  getIndexStatements,
  getDropStatements,

  // Adapter
  DB_ERROR_CODES,
  DatabaseError,
  validateVectorSearchOptions,
  createRowTransformer,

  // Turso adapter helpers
  buildVectorSearchQuery,
  transformVectorSearchResult,
  createSuccessSyncResult,
  createFailedSyncResult,
  parseDatabaseUrl,
  isValidTursoUrl,
  calculateBackoffDelay,
  toFloat32Array,
  fromFloat32Array,
  validateEmbeddingDimensions,
  DEFAULT_RETRY_CONFIG,
} from './index';

describe('DB Configuration', () => {
  describe('DB_DEFAULTS', () => {
    it('should have correct vector dimensions', () => {
      expect(DB_DEFAULTS.vectorDimensions).toBe(1536);
    });

    it('should have correct max neighbors', () => {
      expect(DB_DEFAULTS.maxNeighbors).toBe(50);
    });

    it('should have correct sync batch size', () => {
      expect(DB_DEFAULTS.syncBatchSize).toBe(100);
    });

    it('should have correct schema version', () => {
      expect(DB_DEFAULTS.schemaVersion).toBe(2);
    });
  });

  describe('DATABASE_MODES', () => {
    it('should have all expected modes', () => {
      expect(DATABASE_MODES).toEqual(['local', 'cloud', 'replica']);
    });
  });

  describe('SYNC_MODES', () => {
    it('should have all expected modes', () => {
      expect(SYNC_MODES).toEqual(['auto', 'manual', 'disabled']);
    });
  });

  describe('PRIVACY_TIERS', () => {
    it('should have all expected tiers', () => {
      expect(PRIVACY_TIERS).toEqual(['standard', 'private']);
    });
  });

  describe('createDefaultDatabaseOptions', () => {
    it('should create valid default options', () => {
      const options = createDefaultDatabaseOptions();

      expect(options.mode).toBe('replica');
      expect(options.enableWAL).toBe(true);
      expect(options.vectorDimensions).toBe(1536);
      expect(options.maxNeighbors).toBe(50);
      expect(options.maxRetries).toBe(3);
    });

    it('should pass validation', () => {
      const options = createDefaultDatabaseOptions();
      expect(validateDatabaseOptions(options)).toBe(true);
    });
  });

  describe('createDefaultSyncConfig', () => {
    it('should create valid default config', () => {
      const config = createDefaultSyncConfig();

      expect(config.mode).toBe('auto');
      expect(config.batchSize).toBe(100);
      expect(config.wifiOnly).toBe(false);
      expect(config.backgroundSync).toBe(true);
    });

    it('should pass validation', () => {
      const config = createDefaultSyncConfig();
      expect(validateSyncConfig(config)).toBe(true);
    });
  });

  describe('createDefaultInfrastructureConfig', () => {
    it('should create valid full config', () => {
      const tursoConfig: TursoConfig = {
        url: 'libsql://test.turso.io',
        authToken: 'test-token',
      };

      const config = createDefaultInfrastructureConfig(tursoConfig);

      expect(config.turso.url).toBe('libsql://test.turso.io');
      expect(config.database.mode).toBe('replica');
      expect(config.sync.mode).toBe('auto');
    });

    it('should pass validation', () => {
      const tursoConfig: TursoConfig = {
        url: 'file:local.db',
      };

      const config = createDefaultInfrastructureConfig(tursoConfig);
      expect(validateInfrastructureConfig(config)).toBe(true);
    });
  });

  describe('validateTursoConfig', () => {
    it('should validate valid config', () => {
      expect(
        validateTursoConfig({ url: 'libsql://test.turso.io' })
      ).toBe(true);
    });

    it('should reject empty URL', () => {
      expect(validateTursoConfig({ url: '' })).toBe(false);
    });

    it('should reject missing URL', () => {
      expect(validateTursoConfig({})).toBe(false);
    });
  });
});

describe('DB Schema', () => {
  describe('Table definitions', () => {
    it('should have nodes table', () => {
      expect(NODES_TABLE).toContain('CREATE TABLE IF NOT EXISTS nodes');
      expect(NODES_TABLE).toContain('embedding F32_BLOB');
      expect(NODES_TABLE).toContain('neural_stability');
    });

    it('should have edges table', () => {
      expect(EDGES_TABLE).toContain('CREATE TABLE IF NOT EXISTS edges');
      expect(EDGES_TABLE).toContain('source_id TEXT NOT NULL');
      expect(EDGES_TABLE).toContain('target_id TEXT NOT NULL');
    });

    it('should have episodes table', () => {
      expect(EPISODES_TABLE).toContain('CREATE TABLE IF NOT EXISTS episodes');
      expect(EPISODES_TABLE).toContain('tps_temporal_confidence');
    });
  });

  describe('FULL_SCHEMA', () => {
    it('should be an array of strings', () => {
      expect(Array.isArray(FULL_SCHEMA)).toBe(true);
      expect(FULL_SCHEMA.length).toBeGreaterThan(0);
      FULL_SCHEMA.forEach((statement) => {
        expect(typeof statement).toBe('string');
      });
    });
  });

  describe('QUERIES', () => {
    it('should have vector search query', () => {
      expect(QUERIES.vectorSearch).toContain('vector_distance_cos');
    });

    it('should have node lookup query', () => {
      expect(QUERIES.getNodeById).toContain('SELECT * FROM nodes');
    });

    it('should have edge queries', () => {
      expect(QUERIES.getEdgesForNode).toContain('SELECT * FROM edges');
      expect(QUERIES.getOutgoingEdges).toContain('source_id');
    });
  });

  describe('Schema helpers', () => {
    it('should get table statements', () => {
      const tables = getTableStatements();
      expect(tables.length).toBe(8);
    });

    it('should get index statements', () => {
      const indexes = getIndexStatements();
      expect(indexes.length).toBeGreaterThan(0);
    });

    it('should get drop statements', () => {
      const drops = getDropStatements();
      expect(drops.length).toBe(8);
      drops.forEach((statement) => {
        expect(statement).toContain('DROP TABLE IF EXISTS');
      });
    });
  });
});

describe('DB Adapter', () => {
  describe('DatabaseError', () => {
    it('should create error with code', () => {
      const error = new DatabaseError(
        'CONNECTION_FAILED',
        'Failed to connect'
      );
      expect(error.code).toBe('CONNECTION_FAILED');
      expect(error.message).toBe('Failed to connect');
      expect(error.name).toBe('DatabaseError');
    });

    it('should include cause', () => {
      const cause = new Error('Original error');
      const error = new DatabaseError('QUERY_FAILED', 'Query failed', cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe('DB_ERROR_CODES', () => {
    it('should have all expected error codes', () => {
      expect(DB_ERROR_CODES).toContain('CONNECTION_FAILED');
      expect(DB_ERROR_CODES).toContain('QUERY_FAILED');
      expect(DB_ERROR_CODES).toContain('SYNC_FAILED');
      expect(DB_ERROR_CODES).toContain('CONFLICT');
    });
  });

  describe('validateVectorSearchOptions', () => {
    it('should validate valid options', () => {
      const options = {
        embedding: new Float32Array(1536),
        limit: 10,
      };
      expect(validateVectorSearchOptions(options)).toBe(true);
    });

    it('should reject invalid limit', () => {
      const options = {
        embedding: new Float32Array(1536),
        limit: 0,
      };
      expect(validateVectorSearchOptions(options)).toBe(false);
    });

    it('should reject limit over 1000', () => {
      const options = {
        embedding: new Float32Array(1536),
        limit: 1001,
      };
      expect(validateVectorSearchOptions(options)).toBe(false);
    });
  });

  describe('createRowTransformer', () => {
    it('should create a transformer function', () => {
      const transformer = createRowTransformer<{ id: string }>((row) => ({
        id: row['id'] as string,
      }));

      const result = transformer({ id: 'test-123' });
      expect(result.id).toBe('test-123');
    });
  });
});

describe('Turso Adapter Helpers', () => {
  describe('buildVectorSearchQuery', () => {
    it('should build basic query', () => {
      const embedding = new Float32Array(1536);
      const [sql, params] = buildVectorSearchQuery({
        embedding,
        limit: 10,
      });

      expect(sql).toContain('vector_distance_cos');
      expect(sql).toContain('ORDER BY distance ASC');
      expect(params).toContain(embedding);
      expect(params).toContain(10);
    });

    it('should include layer filter', () => {
      const embedding = new Float32Array(1536);
      const [sql, params] = buildVectorSearchQuery({
        embedding,
        limit: 10,
        layer: 'semantic',
      });

      expect(sql).toContain('layer = ?');
      expect(params).toContain('semantic');
    });

    it('should include custom filters', () => {
      const embedding = new Float32Array(1536);
      const [sql, params] = buildVectorSearchQuery({
        embedding,
        limit: 10,
        filters: { type: 'concept' },
      });

      expect(sql).toContain('type = ?');
      expect(params).toContain('concept');
    });
  });

  describe('transformVectorSearchResult', () => {
    it('should transform row to result', () => {
      const row = {
        id: 'node-123',
        type: 'concept',
        content_title: 'Test',
        content_summary: 'Summary',
        distance: 0.2,
      };

      const result = transformVectorSearchResult(row);

      expect(result.nodeId).toBe('node-123');
      expect(result.type).toBe('concept');
      expect(result.title).toBe('Test');
      expect(result.distance).toBe(0.2);
      expect(result.score).toBe(0.9); // 1 - 0.2/2
    });
  });

  describe('Sync result helpers', () => {
    it('should create success sync result', () => {
      const stats = {
        framesTotal: 100,
        framesSynced: 50,
        bytesTransferred: 1024,
        durationMs: 500,
      };

      const result = createSuccessSyncResult(stats);

      expect(result.success).toBe(true);
      expect(result.framesSynced).toBe(50);
      expect(result.durationMs).toBe(500);
    });

    it('should create failed sync result', () => {
      const result = createFailedSyncResult('Network error', 100);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(result.durationMs).toBe(100);
    });
  });

  describe('parseDatabaseUrl', () => {
    it('should identify local file', () => {
      expect(parseDatabaseUrl('file:local.db')).toBe('local');
    });

    it('should identify cloud URL', () => {
      expect(parseDatabaseUrl('libsql://test.turso.io')).toBe('cloud');
      expect(parseDatabaseUrl('https://test.turso.io')).toBe('cloud');
    });

    it('should default to replica', () => {
      expect(parseDatabaseUrl('other://format')).toBe('replica');
    });
  });

  describe('isValidTursoUrl', () => {
    it('should accept file URLs', () => {
      expect(isValidTursoUrl('file:local.db')).toBe(true);
    });

    it('should accept libsql URLs', () => {
      expect(isValidTursoUrl('libsql://test.turso.io')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(isValidTursoUrl('not a url')).toBe(false);
    });
  });

  describe('calculateBackoffDelay', () => {
    it('should calculate exponential delay', () => {
      expect(calculateBackoffDelay(0)).toBe(1000);
      expect(calculateBackoffDelay(1)).toBe(2000);
      expect(calculateBackoffDelay(2)).toBe(4000);
    });

    it('should cap at max delay', () => {
      expect(calculateBackoffDelay(10)).toBe(30000);
    });

    it('should use custom config', () => {
      const config = {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 5000,
      };
      expect(calculateBackoffDelay(0, config)).toBe(500);
      expect(calculateBackoffDelay(5, config)).toBe(5000);
    });
  });

  describe('Embedding helpers', () => {
    it('should convert array to Float32Array', () => {
      const arr = [0.1, 0.2, 0.3];
      const result = toFloat32Array(arr);
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(3);
    });

    it('should convert Float32Array to array', () => {
      const float32 = new Float32Array([0.1, 0.2, 0.3]);
      const result = fromFloat32Array(float32);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
    });

    it('should validate embedding dimensions', () => {
      const valid = new Float32Array(1536);
      const invalid = new Float32Array(768);

      expect(validateEmbeddingDimensions(valid, 1536)).toBe(true);
      expect(validateEmbeddingDimensions(invalid, 1536)).toBe(false);
    });
  });

  describe('DEFAULT_RETRY_CONFIG', () => {
    it('should have expected values', () => {
      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_RETRY_CONFIG.baseDelayMs).toBe(1000);
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(30000);
    });
  });
});
