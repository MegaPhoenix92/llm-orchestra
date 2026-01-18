#!/usr/bin/env node
/**
 * LLM Orchestra Dashboard CLI
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { statsCommand } from './commands/stats.js';
import { tracesCommand } from './commands/traces.js';
import { costsCommand } from './commands/costs.js';
import { healthCommand } from './commands/health.js';
import { createStandaloneServer } from '../server/standalone.js';

const DEFAULT_SERVER_URL = 'http://localhost:3737';

const program = new Command();

program
  .name('orchestra-dashboard')
  .description('CLI for LLM Orchestra Dashboard')
  .version('0.1.0')
  .option(
    '-s, --server <url>',
    'Dashboard server URL',
    DEFAULT_SERVER_URL
  );

// Stats command
program
  .command('stats')
  .description('Display usage statistics')
  .action(async () => {
    const opts = program.opts();
    await statsCommand(opts.server);
  });

// Traces command
program
  .command('traces [traceId]')
  .description('List traces or view trace detail')
  .option('-l, --limit <number>', 'Number of traces to show', '20')
  .option('--status <status>', 'Filter by status (ok, error)')
  .option('-p, --provider <provider>', 'Filter by provider')
  .action(async (traceId, options) => {
    const opts = program.opts();
    await tracesCommand(opts.server, traceId, {
      limit: parseInt(options.limit),
      status: options.status,
      provider: options.provider,
    });
  });

// Costs command
program
  .command('costs')
  .description('Display cost breakdown')
  .action(async () => {
    const opts = program.opts();
    await costsCommand(opts.server);
  });

// Health command
program
  .command('health')
  .description('Display provider health status')
  .action(async () => {
    const opts = program.opts();
    await healthCommand(opts.server);
  });

// Serve command (for standalone mode with mock data)
program
  .command('serve')
  .description('Start the dashboard server in demo mode (mock data)')
  .option('-p, --port <number>', 'Port to listen on', '3737')
  .option('--open', 'Open browser automatically')
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      console.error(chalk.red('Error: Invalid port number'));
      process.exit(1);
    }

    console.log(chalk.cyan('\n🎼 Starting LLM Orchestra Dashboard (demo mode)'));
    console.log(chalk.gray('Using mock data for demonstration.\n'));
    console.log(chalk.yellow('For production use, attach to a real Orchestra instance:'));
    console.log(chalk.gray(`
  import { Orchestra } from 'llm-orchestra';
  import { attachDashboard } from '@llm-orchestra/dashboard';

  const orchestra = new Orchestra({ /* config */ });
  const dashboard = attachDashboard(orchestra, { port: ${port} });
`));

    const server = createStandaloneServer({
      port,
      open: options.open ?? false,
    });

    await server.start();
    console.log(chalk.gray('Press Ctrl+C to stop the server.'));

    const shutdown = () => {
      server.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

// Default action: show help
program.action(() => {
  program.help();
});

// Error handling
program.showHelpAfterError();

// Run
program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});
