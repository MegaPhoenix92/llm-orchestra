/**
 * Database Connection Module for LLM Orchestra Dashboard
 *
 * Provides PostgreSQL connection pooling and Drizzle ORM instance creation
 * for multi-tenant observability data storage.
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema.js';

// Re-export all schema types for convenience
export * from './schema.js';

// Re-export encrypted field utilities
export * from './encrypted-fields.js';

/**
 * Database instance type with full schema
 */
export type Database = NodePgDatabase<typeof schema>;

/**
 * Result of createDatabase function
 */
export interface DatabaseConnection {
  /** Drizzle database instance with typed schema */
  db: Database;
  /** Underlying PostgreSQL connection pool */
  pool: Pool;
}

/**
 * Creates a PostgreSQL connection pool and Drizzle ORM instance
 *
 * @param connectionString - PostgreSQL connection URL
 *   Format: postgresql://user:password@host:port/database
 * @param poolConfig - Optional additional pool configuration
 * @returns Object containing the Drizzle db instance and underlying pool
 *
 * @example
 * ```typescript
 * const { db, pool } = createDatabase(process.env.DATABASE_URL);
 *
 * // Use db for queries
 * const orgs = await db.select().from(organizations);
 *
 * // Clean up on shutdown
 * await pool.end();
 * ```
 */
export function createDatabase(
  connectionString: string,
  poolConfig?: Omit<PoolConfig, 'connectionString'>
): DatabaseConnection {
  const pool = new Pool({
    connectionString,
    // Sensible defaults for connection pooling
    max: poolConfig?.max ?? 10,
    idleTimeoutMillis: poolConfig?.idleTimeoutMillis ?? 30000,
    connectionTimeoutMillis: poolConfig?.connectionTimeoutMillis ?? 5000,
    ...poolConfig,
  });

  const db = drizzle(pool, { schema });

  return { db, pool };
}

/**
 * Creates a database connection from environment variables
 *
 * Looks for DATABASE_URL environment variable
 *
 * @param poolConfig - Optional additional pool configuration
 * @returns Database connection or throws if DATABASE_URL is not set
 *
 * @example
 * ```typescript
 * const { db, pool } = createDatabaseFromEnv();
 * ```
 */
export function createDatabaseFromEnv(
  poolConfig?: Omit<PoolConfig, 'connectionString'>
): DatabaseConnection {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL environment variable is required. ' +
        'Set it to your PostgreSQL connection string: ' +
        'postgresql://user:password@host:port/database'
    );
  }

  return createDatabase(connectionString, poolConfig);
}
