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

const DEFAULT_SERVER_URL = 'http://localhost:3737';

const program = new Command();

program
  .name('orchestra-dashboard')
  .description('CLI for LLM Orchestra Dashboard')
  .version('0.1.0');

program
  .command('stats')
  .description('Show current statistics')
  .option('-s, --server <url>', 'Dashboard server URL', DEFAULT_SERVER_URL)
  .action(async (options) => {
    await statsCommand(options.server);
  });

program
  .command('traces')
  .description('List recent traces')
  .option('-s, --server <url>', 'Dashboard server URL', DEFAULT_SERVER_URL)
  .option('-l, --limit <n>', 'Number of traces to show', '20')
  .action(async (options) => {
    await tracesCommand(options.server, parseInt(options.limit, 10));
  });

program
  .command('costs')
  .description('Show cost breakdown by provider and model')
  .option('-s, --server <url>', 'Dashboard server URL', DEFAULT_SERVER_URL)
  .action(async (options) => {
    await costsCommand(options.server);
  });

program
  .command('health')
  .description('Show provider health status')
  .option('-s, --server <url>', 'Dashboard server URL', DEFAULT_SERVER_URL)
  .action(async (options) => {
    await healthCommand(options.server);
  });

program
  .command('serve')
  .description('Start the dashboard web server (requires Orchestra instance)')
  .option('-p, --port <port>', 'Port to listen on', '3737')
  .option('-o, --open', 'Open browser automatically')
  .action(async (options) => {
    console.log(chalk.yellow('\nNote: The serve command requires an Orchestra instance.'));
    console.log(chalk.gray('Use attachDashboard() in your application code instead.\n'));
    console.log(chalk.cyan('Example:'));
    console.log(chalk.gray('  import { Orchestra } from "llm-orchestra";'));
    console.log(chalk.gray('  import { attachDashboard } from "@llm-orchestra/dashboard";'));
    console.log(chalk.gray(''));
    console.log(chalk.gray('  const orchestra = new Orchestra({ providers: { ... } });'));
    console.log(chalk.gray('  const dashboard = await attachDashboard(orchestra, { port: ' + options.port + ', open: ' + !!options.open + ' });'));
    console.log('');
  });

program.parse();
