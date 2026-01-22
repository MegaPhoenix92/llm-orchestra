/**
 * Encryption Migration CLI Commands
 *
 * Provides commands to manage encryption at rest:
 * - migrate: Encrypt existing unencrypted data
 * - validate: Verify all data is properly encrypted
 * - status: Show encryption status report
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { createDatabase, users, invitations, auditLogs, type Database } from '../../db/index.js';
import {
  encrypt,
  decrypt,
  decryptJson,
  isEncrypted,
  validateEncryptionConfig,
  needsReEncryption,
  clearKeyCache,
  type EncryptionConfig,
} from '../../auth/encryption.js';
import { encryptUser, encryptInvitation, encryptAuditLog, hashEmailForLookup } from '../../db/encrypted-fields.js';
import { eq, sql, gt, asc } from 'drizzle-orm';

type UserRow = typeof users.$inferSelect;
type InvitationRow = typeof invitations.$inferSelect;
type AuditLogRow = typeof auditLogs.$inferSelect;

/**
 * Options for encryption commands
 */
export interface EncryptOptions {
  /** PostgreSQL connection string */
  databaseUrl: string;
  /** Master encryption key (min 32 characters) */
  masterKey: string;
  /** Batch size for processing (default: 100) */
  batchSize?: number;
  /** Dry run mode - don't actually modify data */
  dryRun?: boolean;
  /** Verbose output */
  verbose?: boolean;
}

/**
 * Options for key rotation command
 */
export interface RotateOptions {
  /** PostgreSQL connection string */
  databaseUrl: string;
  /** Current/old master encryption key */
  oldKey: string;
  /** New master encryption key */
  newKey: string;
  /** Key ID for the old key (defaults to 'primary') */
  oldKeyId?: string;
  /** Key ID for the new key (defaults to 'rotated') */
  newKeyId?: string;
  /** Batch size for processing (default: 100) */
  batchSize?: number;
  /** Dry run mode - don't actually modify data */
  dryRun?: boolean;
  /** Verbose output */
  verbose?: boolean;
}

/**
 * Encryption status report
 */
interface EncryptionStatus {
  table: string;
  total: number;
  encrypted: number;
  unencrypted: number;
  percentage: number;
  v1Count: number;
  v2Count: number;
}

/**
 * Validate encryption options
 */
function validateOptions(options: EncryptOptions): EncryptionConfig {
  if (!options.databaseUrl) {
    console.error(chalk.red('Error:'), 'Database URL is required');
    console.log(chalk.gray('Use --database-url <url> or set DATABASE_URL environment variable'));
    process.exit(1);
  }

  if (!options.masterKey) {
    console.error(chalk.red('Error:'), 'Master encryption key is required');
    console.log(chalk.gray('Use --master-key <key> or set ENCRYPTION_MASTER_KEY environment variable'));
    process.exit(1);
  }

  const config: EncryptionConfig = { masterKey: options.masterKey };

  if (!validateEncryptionConfig(config)) {
    console.error(chalk.red('Error:'), 'Invalid encryption key (must be at least 32 characters)');
    process.exit(1);
  }

  return config;
}

/**
 * Create database connection
 */
function connectDatabase(databaseUrl: string): Database {
  try {
    const { db } = createDatabase(databaseUrl);
    return db;
  } catch (error) {
    console.error(chalk.red('Error:'), 'Failed to connect to database');
    console.error(chalk.gray((error as Error).message));
    process.exit(1);
  }
}

/**
 * Count encrypted/unencrypted records in a text column
 */
async function countEncryptedField(
  db: Database,
  tableName: string,
  fieldName: string
): Promise<{ encrypted: number; unencrypted: number; v1Count: number; v2Count: number }> {
  // Count records with v1 format
  const v1Result = await db.execute(
    sql`SELECT COUNT(*) as count FROM ${sql.identifier(tableName)}
        WHERE ${sql.identifier(fieldName)} IS NOT NULL
        AND ${sql.identifier(fieldName)} LIKE 'v1:%'`
  );

  // Count records with v2 format
  const v2Result = await db.execute(
    sql`SELECT COUNT(*) as count FROM ${sql.identifier(tableName)}
        WHERE ${sql.identifier(fieldName)} IS NOT NULL
        AND ${sql.identifier(fieldName)} LIKE 'v2:%'`
  );

  // Count records where field doesn't start with 'v1:' or 'v2:' (unencrypted)
  const unencryptedResult = await db.execute(
    sql`SELECT COUNT(*) as count FROM ${sql.identifier(tableName)}
        WHERE ${sql.identifier(fieldName)} IS NOT NULL
        AND ${sql.identifier(fieldName)} != ''
        AND ${sql.identifier(fieldName)} NOT LIKE 'v1:%'
        AND ${sql.identifier(fieldName)} NOT LIKE 'v2:%'`
  );

  const v1Count = Number((v1Result.rows[0] as { count: string }).count);
  const v2Count = Number((v2Result.rows[0] as { count: string }).count);
  const unencrypted = Number((unencryptedResult.rows[0] as { count: string }).count);

  return { encrypted: v1Count + v2Count, unencrypted, v1Count, v2Count };
}

/**
 * Status command - Show encryption status report
 */
export async function statusCommand(options: EncryptOptions): Promise<void> {
  console.log('\n' + chalk.bold.cyan('Encryption Status Report') + '\n');

  // Validate options (key validation is optional for status)
  if (!options.databaseUrl) {
    console.error(chalk.red('Error:'), 'Database URL is required');
    process.exit(1);
  }

  const db = connectDatabase(options.databaseUrl);

  const statuses: EncryptionStatus[] = [];

  // Check users table
  console.log(chalk.gray('Checking users table...'));
  const userEmailStats = await countEncryptedField(db, 'users', 'email');
  const userNameStats = await countEncryptedField(db, 'users', 'name');
  const userSsoIdStats = await countEncryptedField(db, 'users', 'sso_id');

  // Aggregate user stats (use email as primary indicator)
  const userTotal = userEmailStats.encrypted + userEmailStats.unencrypted;
  statuses.push({
    table: 'users (email)',
    total: userTotal,
    encrypted: userEmailStats.encrypted,
    unencrypted: userEmailStats.unencrypted,
    percentage: userTotal > 0 ? Math.round((userEmailStats.encrypted / userTotal) * 100) : 100,
    v1Count: userEmailStats.v1Count,
    v2Count: userEmailStats.v2Count,
  });

  // Filter out empty name records for name stats
  if (userNameStats.encrypted + userNameStats.unencrypted > 0) {
    statuses.push({
      table: 'users (name)',
      total: userNameStats.encrypted + userNameStats.unencrypted,
      encrypted: userNameStats.encrypted,
      unencrypted: userNameStats.unencrypted,
      percentage:
        userNameStats.encrypted + userNameStats.unencrypted > 0
          ? Math.round(
              (userNameStats.encrypted / (userNameStats.encrypted + userNameStats.unencrypted)) * 100
            )
          : 100,
      v1Count: userNameStats.v1Count,
      v2Count: userNameStats.v2Count,
    });
  }

  if (userSsoIdStats.encrypted + userSsoIdStats.unencrypted > 0) {
    statuses.push({
      table: 'users (ssoId)',
      total: userSsoIdStats.encrypted + userSsoIdStats.unencrypted,
      encrypted: userSsoIdStats.encrypted,
      unencrypted: userSsoIdStats.unencrypted,
      percentage:
        userSsoIdStats.encrypted + userSsoIdStats.unencrypted > 0
          ? Math.round(
              (userSsoIdStats.encrypted / (userSsoIdStats.encrypted + userSsoIdStats.unencrypted)) * 100
            )
          : 100,
      v1Count: userSsoIdStats.v1Count,
      v2Count: userSsoIdStats.v2Count,
    });
  }

  // Check invitations table
  console.log(chalk.gray('Checking invitations table...'));
  const invEmailStats = await countEncryptedField(db, 'invitations', 'email');
  const invTokenStats = await countEncryptedField(db, 'invitations', 'token');

  if (invEmailStats.encrypted + invEmailStats.unencrypted > 0) {
    statuses.push({
      table: 'invitations (email)',
      total: invEmailStats.encrypted + invEmailStats.unencrypted,
      encrypted: invEmailStats.encrypted,
      unencrypted: invEmailStats.unencrypted,
      percentage:
        invEmailStats.encrypted + invEmailStats.unencrypted > 0
          ? Math.round(
              (invEmailStats.encrypted / (invEmailStats.encrypted + invEmailStats.unencrypted)) * 100
            )
          : 100,
      v1Count: invEmailStats.v1Count,
      v2Count: invEmailStats.v2Count,
    });
  }

  if (invTokenStats.encrypted + invTokenStats.unencrypted > 0) {
    statuses.push({
      table: 'invitations (token)',
      total: invTokenStats.encrypted + invTokenStats.unencrypted,
      encrypted: invTokenStats.encrypted,
      unencrypted: invTokenStats.unencrypted,
      percentage:
        invTokenStats.encrypted + invTokenStats.unencrypted > 0
          ? Math.round(
              (invTokenStats.encrypted / (invTokenStats.encrypted + invTokenStats.unencrypted)) * 100
            )
          : 100,
      v1Count: invTokenStats.v1Count,
      v2Count: invTokenStats.v2Count,
    });
  }

  // Check audit_logs table
  console.log(chalk.gray('Checking audit_logs table...'));
  const auditIpStats = await countEncryptedField(db, 'audit_logs', 'ip');
  const auditUaStats = await countEncryptedField(db, 'audit_logs', 'user_agent');

  if (auditIpStats.encrypted + auditIpStats.unencrypted > 0) {
    statuses.push({
      table: 'audit_logs (ip)',
      total: auditIpStats.encrypted + auditIpStats.unencrypted,
      encrypted: auditIpStats.encrypted,
      unencrypted: auditIpStats.unencrypted,
      percentage:
        auditIpStats.encrypted + auditIpStats.unencrypted > 0
          ? Math.round(
              (auditIpStats.encrypted / (auditIpStats.encrypted + auditIpStats.unencrypted)) * 100
            )
          : 100,
      v1Count: auditIpStats.v1Count,
      v2Count: auditIpStats.v2Count,
    });
  }

  if (auditUaStats.encrypted + auditUaStats.unencrypted > 0) {
    statuses.push({
      table: 'audit_logs (userAgent)',
      total: auditUaStats.encrypted + auditUaStats.unencrypted,
      encrypted: auditUaStats.encrypted,
      unencrypted: auditUaStats.unencrypted,
      percentage:
        auditUaStats.encrypted + auditUaStats.unencrypted > 0
          ? Math.round(
              (auditUaStats.encrypted / (auditUaStats.encrypted + auditUaStats.unencrypted)) * 100
            )
          : 100,
      v1Count: auditUaStats.v1Count,
      v2Count: auditUaStats.v2Count,
    });
  }

  // Check for email_hash column population
  console.log(chalk.gray('Checking email hash index...'));
  const emailHashResult = await db.execute(
    sql`SELECT
          COUNT(*) FILTER (WHERE email_hash IS NOT NULL) as with_hash,
          COUNT(*) FILTER (WHERE email_hash IS NULL) as without_hash
        FROM users`
  );
  const withHash = Number((emailHashResult.rows[0] as { with_hash: string }).with_hash);
  const withoutHash = Number((emailHashResult.rows[0] as { without_hash: string }).without_hash);

  // Display results
  const table = new Table({
    head: [
      chalk.bold('Table/Field'),
      chalk.bold('Total'),
      chalk.bold('Encrypted'),
      chalk.bold('Unencrypted'),
      chalk.bold('v1'),
      chalk.bold('v2'),
      chalk.bold('Progress'),
    ],
    style: { head: [], border: [] },
  });

  for (const status of statuses) {
    const progressBar = createProgressBar(status.percentage);
    const color = status.percentage === 100 ? chalk.green : status.percentage > 0 ? chalk.yellow : chalk.red;

    table.push([
      chalk.cyan(status.table),
      String(status.total),
      chalk.green(String(status.encrypted)),
      status.unencrypted > 0 ? chalk.red(String(status.unencrypted)) : chalk.gray('0'),
      status.v1Count > 0 ? chalk.yellow(String(status.v1Count)) : chalk.gray('0'),
      status.v2Count > 0 ? chalk.green(String(status.v2Count)) : chalk.gray('0'),
      color(progressBar + ' ' + status.percentage + '%'),
    ]);
  }

  console.log(table.toString());

  // Email hash status
  console.log('\n' + chalk.bold('Email Hash Index:'));
  if (withoutHash > 0) {
    console.log(
      chalk.yellow(`  ⚠ ${withoutHash} users missing email hash (needed for encrypted lookups)`)
    );
  } else if (withHash > 0) {
    console.log(chalk.green(`  ✓ All ${withHash} users have email hash`));
  } else {
    console.log(chalk.gray('  No users in database'));
  }

  // Key version summary
  const totalV1 = statuses.reduce((sum, s) => sum + s.v1Count, 0);
  const totalV2 = statuses.reduce((sum, s) => sum + s.v2Count, 0);
  if (totalV1 > 0 || totalV2 > 0) {
    console.log('\n' + chalk.bold('Encryption Format Versions:'));
    if (totalV1 > 0) {
      console.log(chalk.yellow(`  ⚠ v1 format (legacy): ${totalV1} records - consider key rotation`));
    }
    if (totalV2 > 0) {
      console.log(chalk.green(`  ✓ v2 format (current): ${totalV2} records`));
    }
    if (totalV1 > 0 && totalV2 === 0) {
      console.log(chalk.gray('    Run: orchestra-dashboard encrypt rotate --help'));
    }
  }

  // Summary
  const allEncrypted = statuses.every((s) => s.percentage === 100);
  const someEncrypted = statuses.some((s) => s.percentage > 0);

  console.log('\n' + chalk.bold('Summary:'));
  if (statuses.length === 0 || (statuses.length === 1 && statuses[0].total === 0)) {
    console.log(chalk.gray('  No sensitive data found in database'));
  } else if (allEncrypted && withoutHash === 0) {
    console.log(chalk.green('  ✓ All sensitive data is encrypted'));
  } else if (someEncrypted) {
    console.log(chalk.yellow('  ⚠ Encryption partially complete - run migrate to finish'));
  } else {
    console.log(chalk.red('  ✗ No encryption applied - run migrate to encrypt data'));
  }

  console.log('');
}

/**
 * Create a progress bar string
 */
function createProgressBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

/**
 * Migrate command - Encrypt existing unencrypted data
 */
export async function migrateCommand(options: EncryptOptions): Promise<void> {
  console.log('\n' + chalk.bold.cyan('Encryption Migration') + '\n');

  if (options.dryRun) {
    console.log(chalk.yellow('DRY RUN MODE - No changes will be made\n'));
  }

  const config = validateOptions(options);
  const db = connectDatabase(options.databaseUrl);
  const batchSize = options.batchSize || 100;

  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Migrate users
  console.log(chalk.bold('Migrating users...'));
  const userResult = await migrateUsers(db, config, batchSize, options.dryRun, options.verbose);
  totalMigrated += userResult.migrated;
  totalSkipped += userResult.skipped;
  totalErrors += userResult.errors;

  // Migrate invitations
  console.log(chalk.bold('\nMigrating invitations...'));
  const invResult = await migrateInvitations(db, config, batchSize, options.dryRun, options.verbose);
  totalMigrated += invResult.migrated;
  totalSkipped += invResult.skipped;
  totalErrors += invResult.errors;

  // Migrate audit logs
  console.log(chalk.bold('\nMigrating audit logs...'));
  const auditResult = await migrateAuditLogs(db, config, batchSize, options.dryRun, options.verbose);
  totalMigrated += auditResult.migrated;
  totalSkipped += auditResult.skipped;
  totalErrors += auditResult.errors;

  // Summary
  console.log('\n' + chalk.bold('Migration Summary:'));
  console.log(chalk.green(`  ✓ Migrated: ${totalMigrated} records`));
  console.log(chalk.gray(`  ○ Skipped (already encrypted): ${totalSkipped} records`));
  if (totalErrors > 0) {
    console.log(chalk.red(`  ✗ Errors: ${totalErrors} records`));
  }

  if (options.dryRun) {
    console.log(chalk.yellow('\nDry run complete. Run without --dry-run to apply changes.'));
  } else {
    console.log(chalk.green('\nMigration complete!'));
  }

  console.log('');
}

/**
 * Migrate users table
 */
async function migrateUsers(
  db: Database,
  config: EncryptionConfig,
  batchSize: number,
  dryRun?: boolean,
  verbose?: boolean
): Promise<{ migrated: number; skipped: number; errors: number }> {
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  let lastId: string | null = null;
  let processed = 0;

  while (true) {
    // Fetch batch of users
    const baseQuery = db.select().from(users);
    const batch: UserRow[] = await (lastId
      ? baseQuery.where(gt(users.id, lastId))
      : baseQuery)
      .orderBy(asc(users.id))
      .limit(batchSize);

    if (batch.length === 0) break;

    for (const user of batch) {
      try {
        // Check if already encrypted
        const emailEncrypted = isEncrypted(user.email);
        const nameEncrypted = !user.name || isEncrypted(user.name);
        const ssoIdEncrypted = !user.ssoId || isEncrypted(user.ssoId);
        const hasEmailHash = !!user.emailHash;

        if (emailEncrypted && nameEncrypted && ssoIdEncrypted && hasEmailHash) {
          skipped++;
          continue;
        }

        if (verbose) {
          console.log(chalk.gray(`  Processing user ${user.id}...`));
        }

        if (!dryRun) {
          // Decrypt any existing encrypted fields first to get plaintext
          const plainEmail = emailEncrypted ? decrypt(user.email, config) : user.email;
          const plainName = user.name ? (nameEncrypted ? decrypt(user.name, config) : user.name) : null;
          const plainSsoId = user.ssoId
            ? ssoIdEncrypted
              ? decrypt(user.ssoId, config)
              : user.ssoId
            : null;

          // Encrypt and update
          const encrypted = encryptUser(
            {
              email: plainEmail,
              emailHash: hashEmailForLookup(plainEmail),
              name: plainName,
              ssoId: plainSsoId,
            },
            config
          );

          await db
            .update(users)
            .set({
              email: encrypted.email,
              emailHash: encrypted.emailHash,
              name: encrypted.name,
              ssoId: encrypted.ssoId,
              updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));
        }

        migrated++;
      } catch (error) {
        errors++;
        if (verbose) {
          console.log(chalk.red(`  Error processing user ${user.id}: ${(error as Error).message}`));
        }
      }
    }

    lastId = batch[batch.length - 1].id;
    processed += batch.length;
    process.stdout.write(chalk.gray(`  Processed ${processed} records...\r`));
  }

  console.log(chalk.gray(`  Processed ${processed} total records`));
  return { migrated, skipped, errors };
}

/**
 * Migrate invitations table
 */
async function migrateInvitations(
  db: Database,
  config: EncryptionConfig,
  batchSize: number,
  dryRun?: boolean,
  verbose?: boolean
): Promise<{ migrated: number; skipped: number; errors: number }> {
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  let lastId: string | null = null;
  let processed = 0;

  while (true) {
    const baseQuery = db.select().from(invitations);
    const batch: InvitationRow[] = await (lastId
      ? baseQuery.where(gt(invitations.id, lastId))
      : baseQuery)
      .orderBy(asc(invitations.id))
      .limit(batchSize);

    if (batch.length === 0) break;

    for (const invitation of batch) {
      try {
        const emailEncrypted = isEncrypted(invitation.email);
        const tokenEncrypted = isEncrypted(invitation.token);

        if (emailEncrypted && tokenEncrypted) {
          skipped++;
          continue;
        }

        if (verbose) {
          console.log(chalk.gray(`  Processing invitation ${invitation.id}...`));
        }

        if (!dryRun) {
          const plainEmail = emailEncrypted ? decrypt(invitation.email, config) : invitation.email;
          const plainToken = tokenEncrypted ? decrypt(invitation.token, config) : invitation.token;

          const encrypted = encryptInvitation({ email: plainEmail, token: plainToken }, config);

          await db
            .update(invitations)
            .set({
              email: encrypted.email,
              token: encrypted.token,
            })
            .where(eq(invitations.id, invitation.id));
        }

        migrated++;
      } catch (error) {
        errors++;
        if (verbose) {
          console.log(
            chalk.red(`  Error processing invitation ${invitation.id}: ${(error as Error).message}`)
          );
        }
      }
    }

    lastId = batch[batch.length - 1].id;
    processed += batch.length;
    process.stdout.write(chalk.gray(`  Processed ${processed} records...\r`));
  }

  console.log(chalk.gray(`  Processed ${processed} total records`));
  return { migrated, skipped, errors };
}

/**
 * Migrate audit_logs table
 */
async function migrateAuditLogs(
  db: Database,
  config: EncryptionConfig,
  batchSize: number,
  dryRun?: boolean,
  verbose?: boolean
): Promise<{ migrated: number; skipped: number; errors: number }> {
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  let lastId: string | null = null;
  let processed = 0;

  while (true) {
    const baseQuery = db.select().from(auditLogs);
    const batch: AuditLogRow[] = await (lastId
      ? baseQuery.where(gt(auditLogs.id, lastId))
      : baseQuery)
      .orderBy(asc(auditLogs.id))
      .limit(batchSize);

    if (batch.length === 0) break;

    for (const log of batch) {
      try {
        const ipEncrypted = !log.ip || isEncrypted(log.ip);
        const uaEncrypted = !log.userAgent || isEncrypted(log.userAgent);
        const metadataEncrypted =
          !log.metadata || (typeof log.metadata === 'string' && isEncrypted(log.metadata));

        if (ipEncrypted && uaEncrypted && metadataEncrypted) {
          skipped++;
          continue;
        }

        if (verbose) {
          console.log(chalk.gray(`  Processing audit log ${log.id}...`));
        }

        if (!dryRun) {
          const plainIp = log.ip ? (ipEncrypted ? decrypt(log.ip, config) : log.ip) : null;
          const plainUa = log.userAgent
            ? uaEncrypted
              ? decrypt(log.userAgent, config)
              : log.userAgent
            : null;

          // Handle metadata - decrypt if it's already encrypted to avoid double-encryption
          let plainMetadata: Record<string, unknown> | null = null;
          if (log.metadata) {
            if (typeof log.metadata === 'string' && isEncrypted(log.metadata)) {
              plainMetadata = decryptJson(log.metadata, config);
            } else if (typeof log.metadata === 'object') {
              plainMetadata = log.metadata as Record<string, unknown>;
            }
          }

          const encrypted = encryptAuditLog(
            {
              ip: plainIp,
              userAgent: plainUa,
              metadata: plainMetadata,
            },
            config
          );

          await db
            .update(auditLogs)
            .set({
              ip: encrypted.ip,
              userAgent: encrypted.userAgent,
              metadata: encrypted.metadata,
            })
            .where(eq(auditLogs.id, log.id));
        }

        migrated++;
      } catch (error) {
        errors++;
        if (verbose) {
          console.log(chalk.red(`  Error processing audit log ${log.id}: ${(error as Error).message}`));
        }
      }
    }

    lastId = batch[batch.length - 1].id;
    processed += batch.length;
    process.stdout.write(chalk.gray(`  Processed ${processed} records...\r`));
  }

  console.log(chalk.gray(`  Processed ${processed} total records`));
  return { migrated, skipped, errors };
}

/**
 * Validate command - Verify all data is properly encrypted and decryptable
 */
export async function validateCommand(options: EncryptOptions): Promise<void> {
  console.log('\n' + chalk.bold.cyan('Encryption Validation') + '\n');

  const config = validateOptions(options);
  const db = connectDatabase(options.databaseUrl);
  const batchSize = options.batchSize || 100;

  let totalValid = 0;
  let totalInvalid = 0;
  let totalUnencrypted = 0;

  // Validate users
  console.log(chalk.bold('Validating users...'));
  const userResult = await validateUsers(db, config, batchSize, options.verbose);
  totalValid += userResult.valid;
  totalInvalid += userResult.invalid;
  totalUnencrypted += userResult.unencrypted;

  // Validate invitations
  console.log(chalk.bold('\nValidating invitations...'));
  const invResult = await validateInvitations(db, config, batchSize, options.verbose);
  totalValid += invResult.valid;
  totalInvalid += invResult.invalid;
  totalUnencrypted += invResult.unencrypted;

  // Validate audit logs
  console.log(chalk.bold('\nValidating audit logs...'));
  const auditResult = await validateAuditLogs(db, config, batchSize, options.verbose);
  totalValid += auditResult.valid;
  totalInvalid += auditResult.invalid;
  totalUnencrypted += auditResult.unencrypted;

  // Summary
  console.log('\n' + chalk.bold('Validation Summary:'));
  console.log(chalk.green(`  ✓ Valid (encrypted & decryptable): ${totalValid} fields`));
  if (totalUnencrypted > 0) {
    console.log(chalk.yellow(`  ⚠ Unencrypted: ${totalUnencrypted} fields`));
  }
  if (totalInvalid > 0) {
    console.log(chalk.red(`  ✗ Invalid (cannot decrypt): ${totalInvalid} fields`));
    console.log(
      chalk.red('    This may indicate corrupted data or wrong encryption key')
    );
  }

  if (totalInvalid === 0 && totalUnencrypted === 0) {
    console.log(chalk.green('\n✓ All encrypted data validated successfully!'));
  } else if (totalInvalid > 0) {
    console.log(chalk.red('\n✗ Validation failed - some data cannot be decrypted'));
    process.exit(1);
  } else {
    console.log(chalk.yellow('\n⚠ Some data is not yet encrypted - run migrate to complete'));
  }

  console.log('');
}

/**
 * Validate users table
 */
async function validateUsers(
  db: Database,
  config: EncryptionConfig,
  batchSize: number,
  verbose?: boolean
): Promise<{ valid: number; invalid: number; unencrypted: number }> {
  let valid = 0;
  let invalid = 0;
  let unencrypted = 0;
  let lastId: string | null = null;
  let checked = 0;

  while (true) {
    const baseQuery = db.select().from(users);
    const batch: UserRow[] = await (lastId
      ? baseQuery.where(gt(users.id, lastId))
      : baseQuery)
      .orderBy(asc(users.id))
      .limit(batchSize);
    if (batch.length === 0) break;

    for (const user of batch) {
      // Check email
      if (isEncrypted(user.email)) {
        try {
          decrypt(user.email, config);
          valid++;
        } catch {
          invalid++;
          if (verbose) {
            console.log(chalk.red(`  Invalid: user ${user.id} email cannot be decrypted`));
          }
        }
      } else {
        unencrypted++;
        if (verbose) {
          console.log(chalk.yellow(`  Unencrypted: user ${user.id} email`));
        }
      }

      // Check name
      if (user.name) {
        if (isEncrypted(user.name)) {
          try {
            decrypt(user.name, config);
            valid++;
          } catch {
            invalid++;
            if (verbose) {
              console.log(chalk.red(`  Invalid: user ${user.id} name cannot be decrypted`));
            }
          }
        } else {
          unencrypted++;
          if (verbose) {
            console.log(chalk.yellow(`  Unencrypted: user ${user.id} name`));
          }
        }
      }

      // Check ssoId
      if (user.ssoId) {
        if (isEncrypted(user.ssoId)) {
          try {
            decrypt(user.ssoId, config);
            valid++;
          } catch {
            invalid++;
            if (verbose) {
              console.log(chalk.red(`  Invalid: user ${user.id} ssoId cannot be decrypted`));
            }
          }
        } else {
          unencrypted++;
          if (verbose) {
            console.log(chalk.yellow(`  Unencrypted: user ${user.id} ssoId`));
          }
        }
      }
    }

    lastId = batch[batch.length - 1].id;
    checked += batch.length;
  }

  console.log(chalk.gray(`  Checked ${checked} users`));
  return { valid, invalid, unencrypted };
}

/**
 * Validate invitations table
 */
async function validateInvitations(
  db: Database,
  config: EncryptionConfig,
  batchSize: number,
  verbose?: boolean
): Promise<{ valid: number; invalid: number; unencrypted: number }> {
  let valid = 0;
  let invalid = 0;
  let unencrypted = 0;
  let lastId: string | null = null;
  let checked = 0;

  while (true) {
    const baseQuery = db.select().from(invitations);
    const batch: InvitationRow[] = await (lastId
      ? baseQuery.where(gt(invitations.id, lastId))
      : baseQuery)
      .orderBy(asc(invitations.id))
      .limit(batchSize);
    if (batch.length === 0) break;

    for (const invitation of batch) {
      // Check email
      if (isEncrypted(invitation.email)) {
        try {
          decrypt(invitation.email, config);
          valid++;
        } catch {
          invalid++;
          if (verbose) {
            console.log(chalk.red(`  Invalid: invitation ${invitation.id} email cannot be decrypted`));
          }
        }
      } else {
        unencrypted++;
        if (verbose) {
          console.log(chalk.yellow(`  Unencrypted: invitation ${invitation.id} email`));
        }
      }

      // Check token
      if (isEncrypted(invitation.token)) {
        try {
          decrypt(invitation.token, config);
          valid++;
        } catch {
          invalid++;
          if (verbose) {
            console.log(chalk.red(`  Invalid: invitation ${invitation.id} token cannot be decrypted`));
          }
        }
      } else {
        unencrypted++;
        if (verbose) {
          console.log(chalk.yellow(`  Unencrypted: invitation ${invitation.id} token`));
        }
      }
    }

    lastId = batch[batch.length - 1].id;
    checked += batch.length;
  }

  console.log(chalk.gray(`  Checked ${checked} invitations`));
  return { valid, invalid, unencrypted };
}

/**
 * Validate audit_logs table
 */
async function validateAuditLogs(
  db: Database,
  config: EncryptionConfig,
  batchSize: number,
  verbose?: boolean
): Promise<{ valid: number; invalid: number; unencrypted: number }> {
  let valid = 0;
  let invalid = 0;
  let unencrypted = 0;
  let lastId: string | null = null;
  let checked = 0;

  while (true) {
    const baseQuery = db.select().from(auditLogs);
    const batch: AuditLogRow[] = await (lastId
      ? baseQuery.where(gt(auditLogs.id, lastId))
      : baseQuery)
      .orderBy(asc(auditLogs.id))
      .limit(batchSize);
    if (batch.length === 0) break;

    for (const log of batch) {
      // Check ip
      if (log.ip) {
        if (isEncrypted(log.ip)) {
          try {
            decrypt(log.ip, config);
            valid++;
          } catch {
            invalid++;
            if (verbose) {
              console.log(chalk.red(`  Invalid: audit log ${log.id} ip cannot be decrypted`));
            }
          }
        } else {
          unencrypted++;
          if (verbose) {
            console.log(chalk.yellow(`  Unencrypted: audit log ${log.id} ip`));
          }
        }
      }

      // Check userAgent
      if (log.userAgent) {
        if (isEncrypted(log.userAgent)) {
          try {
            decrypt(log.userAgent, config);
            valid++;
          } catch {
            invalid++;
            if (verbose) {
              console.log(chalk.red(`  Invalid: audit log ${log.id} userAgent cannot be decrypted`));
            }
          }
        } else {
          unencrypted++;
          if (verbose) {
            console.log(chalk.yellow(`  Unencrypted: audit log ${log.id} userAgent`));
          }
        }
      }

      // Check metadata
      if (log.metadata !== null && log.metadata !== undefined) {
        if (typeof log.metadata === 'string') {
          if (isEncrypted(log.metadata)) {
            try {
              decryptJson(log.metadata, config);
              valid++;
            } catch {
              invalid++;
              if (verbose) {
                console.log(chalk.red(`  Invalid: audit log ${log.id} metadata cannot be decrypted`));
              }
            }
          } else {
            unencrypted++;
            if (verbose) {
              console.log(chalk.yellow(`  Unencrypted: audit log ${log.id} metadata`));
            }
          }
        } else {
          unencrypted++;
          if (verbose) {
            console.log(chalk.yellow(`  Unencrypted: audit log ${log.id} metadata`));
          }
        }
      }
    }

    lastId = batch[batch.length - 1].id;
    checked += batch.length;
  }

  console.log(chalk.gray(`  Checked ${checked} audit logs`));
  return { valid, invalid, unencrypted };
}

/**
 * Validate key rotation options and return config for new key
 * The returned config includes the old key in previousKeys for decryption
 */
function validateRotateOptions(options: RotateOptions): EncryptionConfig {
  if (!options.databaseUrl) {
    console.error(chalk.red('Error:'), 'Database URL is required');
    console.log(chalk.gray('Use --database-url <url> or set DATABASE_URL environment variable'));
    process.exit(1);
  }

  if (!options.oldKey) {
    console.error(chalk.red('Error:'), 'Old encryption key is required');
    console.log(chalk.gray('Use --old-key <key> or set OLD_ENCRYPTION_KEY environment variable'));
    process.exit(1);
  }

  if (!options.newKey) {
    console.error(chalk.red('Error:'), 'New encryption key is required');
    console.log(chalk.gray('Use --new-key <key> or set NEW_ENCRYPTION_KEY environment variable'));
    process.exit(1);
  }

  if (options.newKey.length < 32) {
    console.error(chalk.red('Error:'), 'New encryption key must be at least 32 characters');
    process.exit(1);
  }

  if (options.oldKey === options.newKey) {
    console.error(chalk.red('Error:'), 'Old and new keys must be different');
    process.exit(1);
  }

  const oldKeyId = options.oldKeyId || 'primary';
  const newKeyId = options.newKeyId || 'rotated';

  // Config for encryption with new key (includes old key for decryption)
  return {
    masterKey: options.newKey,
    keyId: newKeyId,
    previousKeys: [{ keyId: oldKeyId, masterKey: options.oldKey }],
  };
}

/**
 * Rotate command - Re-encrypt all data with a new key
 */
export async function rotateCommand(options: RotateOptions): Promise<void> {
  console.log('\n' + chalk.bold.cyan('Encryption Key Rotation') + '\n');

  if (options.dryRun) {
    console.log(chalk.yellow('DRY RUN MODE - No changes will be made\n'));
  }

  const newConfig = validateRotateOptions(options);
  const db = connectDatabase(options.databaseUrl);
  const batchSize = options.batchSize || 100;

  // Clear key cache to ensure fresh key derivation
  clearKeyCache();

  let totalRotated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Rotate users
  console.log(chalk.bold('Rotating users...'));
  const userResult = await rotateUsers(db, newConfig, batchSize, options.dryRun, options.verbose);
  totalRotated += userResult.rotated;
  totalSkipped += userResult.skipped;
  totalErrors += userResult.errors;

  // Rotate invitations
  console.log(chalk.bold('\nRotating invitations...'));
  const invResult = await rotateInvitations(db, newConfig, batchSize, options.dryRun, options.verbose);
  totalRotated += invResult.rotated;
  totalSkipped += invResult.skipped;
  totalErrors += invResult.errors;

  // Rotate audit logs
  console.log(chalk.bold('\nRotating audit logs...'));
  const auditResult = await rotateAuditLogs(db, newConfig, batchSize, options.dryRun, options.verbose);
  totalRotated += auditResult.rotated;
  totalSkipped += auditResult.skipped;
  totalErrors += auditResult.errors;

  // Summary
  console.log('\n' + chalk.bold('Key Rotation Summary:'));
  console.log(chalk.green(`  ✓ Rotated: ${totalRotated} records`));
  console.log(chalk.gray(`  ○ Skipped (already on new key or unencrypted): ${totalSkipped} records`));
  if (totalErrors > 0) {
    console.log(chalk.red(`  ✗ Errors: ${totalErrors} records`));
  }

  if (options.dryRun) {
    console.log(chalk.yellow('\nDry run complete. Run without --dry-run to apply changes.'));
  } else {
    console.log(chalk.green('\nKey rotation complete!'));
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.gray('  1. Update ENCRYPTION_MASTER_KEY to the new key'));
    console.log(chalk.gray('  2. Keep the old key configured in previousKeys for a transition period'));
    console.log(chalk.gray('  3. Run "encrypt validate" to verify all data'));
  }

  console.log('');
}

/**
 * Rotate encryption keys for users table
 */
async function rotateUsers(
  db: Database,
  config: EncryptionConfig,
  batchSize: number,
  dryRun?: boolean,
  verbose?: boolean
): Promise<{ rotated: number; skipped: number; errors: number }> {
  let rotated = 0;
  let skipped = 0;
  let errors = 0;
  let lastId: string | null = null;
  let processed = 0;

  const newKeyId = config.keyId || 'rotated';

  while (true) {
    const baseQuery = db.select().from(users);
    const batch: UserRow[] = await (lastId
      ? baseQuery.where(gt(users.id, lastId))
      : baseQuery)
      .orderBy(asc(users.id))
      .limit(batchSize);

    if (batch.length === 0) break;

    for (const user of batch) {
      try {
        // Check if any field needs re-encryption
        const emailNeedsRotation = needsReEncryption(user.email, newKeyId);
        const nameNeedsRotation = user.name ? needsReEncryption(user.name, newKeyId) : false;
        const ssoIdNeedsRotation = user.ssoId ? needsReEncryption(user.ssoId, newKeyId) : false;

        if (!emailNeedsRotation && !nameNeedsRotation && !ssoIdNeedsRotation) {
          skipped++;
          continue;
        }

        if (verbose) {
          console.log(chalk.gray(`  Rotating user ${user.id}...`));
        }

        if (!dryRun) {
          // Decrypt (config has previousKeys for old key, and decrypt tries all keys for v1)
          const plainEmail = isEncrypted(user.email) ? decrypt(user.email, config) : user.email;
          const plainName = user.name
            ? isEncrypted(user.name)
              ? decrypt(user.name, config)
              : user.name
            : null;
          const plainSsoId = user.ssoId
            ? isEncrypted(user.ssoId)
              ? decrypt(user.ssoId, config)
              : user.ssoId
            : null;

          // Re-encrypt with new key
          const newEmail = encrypt(plainEmail, config);
          const newName = plainName ? encrypt(plainName, config) : null;
          const newSsoId = plainSsoId ? encrypt(plainSsoId, config) : null;

          await db
            .update(users)
            .set({
              email: newEmail,
              name: newName,
              ssoId: newSsoId,
              updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));
        }

        rotated++;
      } catch (error) {
        errors++;
        if (verbose) {
          console.log(chalk.red(`  Error rotating user ${user.id}: ${(error as Error).message}`));
        }
      }
    }

    lastId = batch[batch.length - 1].id;
    processed += batch.length;
    process.stdout.write(chalk.gray(`  Processed ${processed} records...\r`));
  }

  console.log(chalk.gray(`  Processed ${processed} total records`));
  return { rotated, skipped, errors };
}

/**
 * Rotate encryption keys for invitations table
 */
async function rotateInvitations(
  db: Database,
  config: EncryptionConfig,
  batchSize: number,
  dryRun?: boolean,
  verbose?: boolean
): Promise<{ rotated: number; skipped: number; errors: number }> {
  let rotated = 0;
  let skipped = 0;
  let errors = 0;
  let lastId: string | null = null;
  let processed = 0;

  const newKeyId = config.keyId || 'rotated';

  while (true) {
    const baseQuery = db.select().from(invitations);
    const batch: InvitationRow[] = await (lastId
      ? baseQuery.where(gt(invitations.id, lastId))
      : baseQuery)
      .orderBy(asc(invitations.id))
      .limit(batchSize);

    if (batch.length === 0) break;

    for (const invitation of batch) {
      try {
        const emailNeedsRotation = needsReEncryption(invitation.email, newKeyId);
        const tokenNeedsRotation = needsReEncryption(invitation.token, newKeyId);

        if (!emailNeedsRotation && !tokenNeedsRotation) {
          skipped++;
          continue;
        }

        if (verbose) {
          console.log(chalk.gray(`  Rotating invitation ${invitation.id}...`));
        }

        if (!dryRun) {
          const plainEmail = isEncrypted(invitation.email)
            ? decrypt(invitation.email, config)
            : invitation.email;
          const plainToken = isEncrypted(invitation.token)
            ? decrypt(invitation.token, config)
            : invitation.token;

          const newEmail = encrypt(plainEmail, config);
          const newToken = encrypt(plainToken, config);

          await db
            .update(invitations)
            .set({
              email: newEmail,
              token: newToken,
            })
            .where(eq(invitations.id, invitation.id));
        }

        rotated++;
      } catch (error) {
        errors++;
        if (verbose) {
          console.log(
            chalk.red(`  Error rotating invitation ${invitation.id}: ${(error as Error).message}`)
          );
        }
      }
    }

    lastId = batch[batch.length - 1].id;
    processed += batch.length;
    process.stdout.write(chalk.gray(`  Processed ${processed} records...\r`));
  }

  console.log(chalk.gray(`  Processed ${processed} total records`));
  return { rotated, skipped, errors };
}

/**
 * Rotate encryption keys for audit_logs table
 */
async function rotateAuditLogs(
  db: Database,
  config: EncryptionConfig,
  batchSize: number,
  dryRun?: boolean,
  verbose?: boolean
): Promise<{ rotated: number; skipped: number; errors: number }> {
  let rotated = 0;
  let skipped = 0;
  let errors = 0;
  let lastId: string | null = null;
  let processed = 0;

  const newKeyId = config.keyId || 'rotated';

  while (true) {
    const baseQuery = db.select().from(auditLogs);
    const batch: AuditLogRow[] = await (lastId
      ? baseQuery.where(gt(auditLogs.id, lastId))
      : baseQuery)
      .orderBy(asc(auditLogs.id))
      .limit(batchSize);

    if (batch.length === 0) break;

    for (const log of batch) {
      try {
        const ipNeedsRotation = log.ip ? needsReEncryption(log.ip, newKeyId) : false;
        const uaNeedsRotation = log.userAgent ? needsReEncryption(log.userAgent, newKeyId) : false;
        const metadataNeedsRotation =
          log.metadata && typeof log.metadata === 'string'
            ? needsReEncryption(log.metadata, newKeyId)
            : false;

        if (!ipNeedsRotation && !uaNeedsRotation && !metadataNeedsRotation) {
          skipped++;
          continue;
        }

        if (verbose) {
          console.log(chalk.gray(`  Rotating audit log ${log.id}...`));
        }

        if (!dryRun) {
          // Handle IP
          let newIp: string | null = null;
          if (log.ip) {
            const plainIp = isEncrypted(log.ip) ? decrypt(log.ip, config) : log.ip;
            newIp = encrypt(plainIp, config);
          }

          // Handle user agent
          let newUa: string | null = null;
          if (log.userAgent) {
            const plainUa = isEncrypted(log.userAgent)
              ? decrypt(log.userAgent, config)
              : log.userAgent;
            newUa = encrypt(plainUa, config);
          }

          // Handle metadata
          let newMetadata: string | Record<string, unknown> | null =
            log.metadata as string | Record<string, unknown> | null;
          if (log.metadata && typeof log.metadata === 'string' && isEncrypted(log.metadata)) {
            const plainMetadata = decryptJson(log.metadata, config);
            if (plainMetadata) {
              newMetadata = encrypt(JSON.stringify(plainMetadata), config);
            }
          }

          await db
            .update(auditLogs)
            .set({
              ip: newIp,
              userAgent: newUa,
              metadata: newMetadata,
            })
            .where(eq(auditLogs.id, log.id));
        }

        rotated++;
      } catch (error) {
        errors++;
        if (verbose) {
          console.log(chalk.red(`  Error rotating audit log ${log.id}: ${(error as Error).message}`));
        }
      }
    }

    lastId = batch[batch.length - 1].id;
    processed += batch.length;
    process.stdout.write(chalk.gray(`  Processed ${processed} records...\r`));
  }

  console.log(chalk.gray(`  Processed ${processed} total records`));
  return { rotated, skipped, errors };
}
