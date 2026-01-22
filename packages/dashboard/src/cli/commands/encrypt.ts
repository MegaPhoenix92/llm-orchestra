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
  isEncrypted,
  validateEncryptionConfig,
  type EncryptionConfig,
} from '../../auth/encryption.js';
import {
  encryptUser,
  decryptUser,
  encryptInvitation,
  encryptAuditLog,
  hashEmailForLookup,
} from '../../db/encrypted-fields.js';
import { eq, isNull, sql } from 'drizzle-orm';

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
 * Encryption status report
 */
interface EncryptionStatus {
  table: string;
  total: number;
  encrypted: number;
  unencrypted: number;
  percentage: number;
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
): Promise<{ encrypted: number; unencrypted: number }> {
  // Count records where field starts with 'v1:' (encrypted)
  const encryptedResult = await db.execute(
    sql`SELECT COUNT(*) as count FROM ${sql.identifier(tableName)}
        WHERE ${sql.identifier(fieldName)} IS NOT NULL
        AND ${sql.identifier(fieldName)} LIKE 'v1:%'`
  );

  // Count records where field doesn't start with 'v1:' (unencrypted)
  const unencryptedResult = await db.execute(
    sql`SELECT COUNT(*) as count FROM ${sql.identifier(tableName)}
        WHERE ${sql.identifier(fieldName)} IS NOT NULL
        AND ${sql.identifier(fieldName)} != ''
        AND ${sql.identifier(fieldName)} NOT LIKE 'v1:%'`
  );

  const encrypted = Number((encryptedResult.rows[0] as { count: string }).count);
  const unencrypted = Number((unencryptedResult.rows[0] as { count: string }).count);

  return { encrypted, unencrypted };
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
  let offset = 0;

  while (true) {
    // Fetch batch of users
    const batch = await db
      .select()
      .from(users)
      .limit(batchSize)
      .offset(offset);

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

    offset += batchSize;
    process.stdout.write(chalk.gray(`  Processed ${offset} records...\r`));
  }

  console.log(chalk.gray(`  Processed ${offset} total records`));
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
  let offset = 0;

  while (true) {
    const batch = await db
      .select()
      .from(invitations)
      .limit(batchSize)
      .offset(offset);

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

    offset += batchSize;
    process.stdout.write(chalk.gray(`  Processed ${offset} records...\r`));
  }

  console.log(chalk.gray(`  Processed ${offset} total records`));
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
  let offset = 0;

  while (true) {
    const batch = await db
      .select()
      .from(auditLogs)
      .limit(batchSize)
      .offset(offset);

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

          const encrypted = encryptAuditLog(
            {
              ip: plainIp,
              userAgent: plainUa,
              metadata: log.metadata as Record<string, unknown> | null,
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

    offset += batchSize;
    process.stdout.write(chalk.gray(`  Processed ${offset} records...\r`));
  }

  console.log(chalk.gray(`  Processed ${offset} total records`));
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
  let offset = 0;

  while (true) {
    const batch = await db.select().from(users).limit(batchSize).offset(offset);
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

    offset += batchSize;
  }

  console.log(chalk.gray(`  Checked ${offset} users`));
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
  let offset = 0;

  while (true) {
    const batch = await db.select().from(invitations).limit(batchSize).offset(offset);
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

    offset += batchSize;
  }

  console.log(chalk.gray(`  Checked ${offset} invitations`));
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
  let offset = 0;

  while (true) {
    const batch = await db.select().from(auditLogs).limit(batchSize).offset(offset);
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
    }

    offset += batchSize;
  }

  console.log(chalk.gray(`  Checked ${offset} audit logs`));
  return { valid, invalid, unencrypted };
}
