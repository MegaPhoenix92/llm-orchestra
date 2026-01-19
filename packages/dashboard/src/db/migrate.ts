/**
 * Database Migration Module for LLM Orchestra Dashboard
 *
 * Provides programmatic migration execution using Drizzle Kit
 * for applying pending schema changes to the database.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Migration options
 */
export interface MigrateOptions {
  /** PostgreSQL connection string */
  connectionString: string;
  /** Path to migrations folder (defaults to ./migrations relative to this file) */
  migrationsFolder?: string;
  /** Whether to log migration progress */
  verbose?: boolean;
}

/**
 * Migration result
 */
export interface MigrateResult {
  /** Whether migrations were successful */
  success: boolean;
  /** Error message if migration failed */
  error?: string;
}

/**
 * Applies pending database migrations
 *
 * This function connects to the database, runs all pending migrations
 * in order, and then closes the connection.
 *
 * @param options - Migration configuration
 * @returns Result indicating success or failure
 *
 * @example
 * ```typescript
 * // Run migrations from environment
 * const result = await migrate({
 *   connectionString: process.env.DATABASE_URL!,
 *   verbose: true,
 * });
 *
 * if (!result.success) {
 *   console.error('Migration failed:', result.error);
 *   process.exit(1);
 * }
 * ```
 */
export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const { connectionString, migrationsFolder, verbose = false } = options;

  // Default migrations folder is ./migrations relative to this file
  const defaultMigrationsFolder = resolve(__dirname, 'migrations');
  const folder = migrationsFolder ?? defaultMigrationsFolder;

  if (verbose) {
    console.log(`Running migrations from: ${folder}`);
  }

  const pool = new Pool({ connectionString });

  try {
    const db = drizzle(pool);

    if (verbose) {
      console.log('Connected to database, applying migrations...');
    }

    await drizzleMigrate(db, { migrationsFolder: folder });

    if (verbose) {
      console.log('Migrations applied successfully');
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (verbose) {
      console.error('Migration failed:', errorMessage);
    }

    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    await pool.end();
  }
}

/**
 * Runs migrations using DATABASE_URL environment variable
 *
 * Convenience function for running migrations with default configuration.
 *
 * @param verbose - Whether to log progress (default: true)
 * @returns Result indicating success or failure
 *
 * @example
 * ```typescript
 * // In a migration script
 * const result = await migrateFromEnv();
 * process.exit(result.success ? 0 : 1);
 * ```
 */
export async function migrateFromEnv(verbose = true): Promise<MigrateResult> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return {
      success: false,
      error:
        'DATABASE_URL environment variable is required. ' +
        'Set it to your PostgreSQL connection string: ' +
        'postgresql://user:password@host:port/database',
    };
  }

  return migrate({ connectionString, verbose });
}

/**
 * CLI entry point for running migrations
 *
 * Can be executed directly: npx tsx src/db/migrate.ts
 */
async function main(): Promise<void> {
  console.log('LLM Orchestra Dashboard - Database Migration');
  console.log('============================================');

  const result = await migrateFromEnv(true);

  if (!result.success) {
    console.error('\nMigration failed:', result.error);
    process.exit(1);
  }

  console.log('\nMigration completed successfully!');
  process.exit(0);
}

// Run if this is the main module
// Check if running directly (not imported)
const isMainModule = process.argv[1]?.includes('migrate');
if (isMainModule) {
  main().catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}
