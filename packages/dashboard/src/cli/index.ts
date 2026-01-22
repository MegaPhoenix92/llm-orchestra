#!/usr/bin/env node
/**
 * LLM Orchestra Dashboard CLI
 *
 * Supports both local and cloud dashboard connections:
 * - Local: Just specify --server (default: http://localhost:3737)
 * - Cloud: Add --api-key and --project-id for authenticated access
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { statsCommand } from './commands/stats.js';
import { tracesCommand } from './commands/traces.js';
import { costsCommand } from './commands/costs.js';
import { healthCommand } from './commands/health.js';
import {
  statusCommand as encryptStatusCommand,
  migrateCommand as encryptMigrateCommand,
  validateCommand as encryptValidateCommand,
  type EncryptOptions,
} from './commands/encrypt.js';
import { validateCloudOptions, type ApiOptions } from './api.js';

const DEFAULT_SERVER_URL = 'http://localhost:3737';

const program = new Command();

program
  .name('orchestra-dashboard')
  .description('CLI for LLM Orchestra Dashboard')
  .version('0.1.0');

// Global options available to all commands with environment variable support
program
  .option('-s, --server <url>', 'Dashboard server URL', DEFAULT_SERVER_URL)
  .option('-k, --api-key <key>', 'API key for cloud authentication')
  .option('-p, --project-id <id>', 'Project ID for multi-tenant queries');

/**
 * Extract API options from command options, with environment variable fallbacks
 */
function getApiOptions(options: Record<string, unknown>): ApiOptions {
  return {
    server: (options.server as string) || process.env.ORCHESTRA_SERVER || DEFAULT_SERVER_URL,
    apiKey: (options.apiKey as string | undefined) || process.env.ORCHESTRA_API_KEY,
    projectId: (options.projectId as string | undefined) || process.env.ORCHESTRA_PROJECT_ID,
  };
}

program
  .command('stats')
  .description('Show current statistics')
  .action(async () => {
    const options = getApiOptions(program.opts());
    validateCloudOptions(options);
    await statsCommand(options);
  });

program
  .command('traces')
  .description('List recent traces')
  .option('-l, --limit <n>', 'Number of traces to show', '20')
  .action(async (cmdOptions) => {
    const options = getApiOptions(program.opts());
    validateCloudOptions(options);
    await tracesCommand(options, parseInt(cmdOptions.limit, 10));
  });

program
  .command('costs')
  .description('Show cost breakdown by provider and model')
  .action(async () => {
    const options = getApiOptions(program.opts());
    validateCloudOptions(options);
    await costsCommand(options);
  });

program
  .command('health')
  .description('Show provider health status')
  .action(async () => {
    const options = getApiOptions(program.opts());
    validateCloudOptions(options);
    await healthCommand(options);
  });

program
  .command('serve')
  .description('Start the dashboard web server (requires Orchestra instance)')
  .option('--port <port>', 'Port to listen on', '3737')
  .option('-o, --open', 'Open browser automatically')
  .action(async (cmdOptions) => {
    console.log(chalk.yellow('\nNote: The serve command requires an Orchestra instance.'));
    console.log(chalk.gray('Use attachDashboard() in your application code instead.\n'));
    console.log(chalk.cyan('Example:'));
    console.log(chalk.gray('  import { Orchestra } from "llm-orchestra";'));
    console.log(chalk.gray('  import { attachDashboard } from "llm-orchestra-dashboard";'));
    console.log(chalk.gray(''));
    console.log(chalk.gray('  const orchestra = new Orchestra({ providers: { ... } });'));
    console.log(
      chalk.gray(
        '  const dashboard = await attachDashboard(orchestra, { port: ' +
          cmdOptions.port +
          ', open: ' +
          !!cmdOptions.open +
          ' });'
      )
    );
    console.log('');
  });

// Encryption management commands
const encryptProgram = program
  .command('encrypt')
  .description('Manage encryption at rest for sensitive data');

/**
 * Extract encryption options from command options
 */
function getEncryptOptions(cmdOptions: Record<string, unknown>): EncryptOptions {
  return {
    databaseUrl:
      (cmdOptions.databaseUrl as string | undefined) || process.env.DATABASE_URL || '',
    masterKey:
      (cmdOptions.masterKey as string | undefined) || process.env.ENCRYPTION_MASTER_KEY || '',
    batchSize: cmdOptions.batchSize ? parseInt(cmdOptions.batchSize as string, 10) : 100,
    dryRun: cmdOptions.dryRun as boolean | undefined,
    verbose: cmdOptions.verbose as boolean | undefined,
  };
}

encryptProgram
  .command('status')
  .description('Show encryption status report for all sensitive data')
  .option('-d, --database-url <url>', 'PostgreSQL connection URL')
  .action(async (cmdOptions) => {
    const options = getEncryptOptions(cmdOptions);
    await encryptStatusCommand(options);
  });

encryptProgram
  .command('migrate')
  .description('Encrypt existing unencrypted data in the database')
  .option('-d, --database-url <url>', 'PostgreSQL connection URL')
  .option('-k, --master-key <key>', 'Master encryption key (min 32 characters)')
  .option('-b, --batch-size <n>', 'Records to process per batch', '100')
  .option('--dry-run', 'Preview changes without applying them')
  .option('-v, --verbose', 'Show detailed progress')
  .action(async (cmdOptions) => {
    const options = getEncryptOptions(cmdOptions);
    await encryptMigrateCommand(options);
  });

encryptProgram
  .command('validate')
  .description('Verify all encrypted data can be decrypted')
  .option('-d, --database-url <url>', 'PostgreSQL connection URL')
  .option('-k, --master-key <key>', 'Master encryption key')
  .option('-b, --batch-size <n>', 'Records to process per batch', '100')
  .option('-v, --verbose', 'Show detailed validation output')
  .action(async (cmdOptions) => {
    const options = getEncryptOptions(cmdOptions);
    await encryptValidateCommand(options);
  });

// Help text for cloud usage
program.addHelpText(
  'after',
  `
${chalk.bold('Cloud Usage:')}
  Connect to a cloud dashboard with authentication:

  $ orchestra-dashboard stats -s https://cloud.example.com -k orch_xxx -p prj_xxx
  $ orchestra-dashboard traces -s https://cloud.example.com -k orch_xxx -p prj_xxx

${chalk.bold('Environment Variables:')}
  ORCHESTRA_SERVER       Default server URL
  ORCHESTRA_API_KEY      Default API key
  ORCHESTRA_PROJECT_ID   Default project ID
  DATABASE_URL           PostgreSQL connection URL (for encrypt commands)
  ENCRYPTION_MASTER_KEY  Encryption master key (for encrypt commands)

${chalk.bold('Encryption Commands:')}
  Manage encryption at rest for sensitive database data:

  $ orchestra-dashboard encrypt status -d postgres://...
  $ orchestra-dashboard encrypt migrate -d postgres://... -k <master-key>
  $ orchestra-dashboard encrypt validate -d postgres://... -k <master-key>

  Use --dry-run with migrate to preview changes without applying them.
`
);

program.parse();
