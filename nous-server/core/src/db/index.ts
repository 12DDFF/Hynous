/**
 * @module @nous/core/db
 * @description Database infrastructure for Nous
 * @version 1.0.0
 * @spec Brainstorms/Specs/storm-017
 *
 * This module provides:
 * - Database configuration types (TursoConfig, DatabaseOptions, SyncConfig)
 * - SQL schema definitions for Turso/libSQL
 * - Database adapter interface and types
 * - Turso-specific implementation helpers
 *
 * The actual database adapter implementation uses @libsql/client which
 * should be installed in the consuming application.
 */

// Configuration types and defaults
export * from './config';

// SQL schema definitions
export * from './schema';

// Database adapter interface
export * from './adapter';

// Turso-specific helpers
export * from './turso-adapter';
