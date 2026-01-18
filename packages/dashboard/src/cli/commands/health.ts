/**
 * CLI command: health
 * Display provider health status
 */

import Table from 'cli-table3';
import chalk from 'chalk';
import type { ProviderHealth } from '../../connectors/types.js';
import { fetchHealth, type HealthResponse } from '../utils/api.js';

export { fetchHealth };

function formatDuration(ms: number): string {
  if (ms === 0) return '-';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function getStatusIcon(available: boolean): string {
  return available ? chalk.green('●') : chalk.red('●');
}

function getProviderColor(provider: string): (text: string) => string {
  switch (provider) {
    case 'anthropic':
      return chalk.hex('#d97706');
    case 'openai':
      return chalk.hex('#10a37f');
    case 'google':
      return chalk.hex('#4285f4');
    case 'mistral':
      return chalk.hex('#ff7000');
    default:
      return chalk.gray;
  }
}

export function displayHealth(
  providers: ProviderHealth[],
  timestamp: number
): void {
  console.log(chalk.bold('\n🏥 LLM Orchestra Provider Health\n'));

  const availableCount = providers.filter((p) => p.available).length;
  const totalCount = providers.length;

  // Summary
  console.log(chalk.cyan('Status Summary'));
  console.log(
    `  Providers Online: ${chalk.green(availableCount.toString())}/${totalCount}`
  );
  console.log(
    `  Availability: ${((availableCount / Math.max(totalCount, 1)) * 100).toFixed(0)}%`
  );
  console.log(`  Last Check: ${new Date(timestamp).toLocaleString()}`);
  console.log('');

  // Provider Table
  const table = new Table({
    head: ['Status', 'Provider', 'Avg Latency', 'Failovers', 'Last Checked'],
    colWidths: [10, 15, 15, 12, 25],
  });

  for (const provider of providers) {
    table.push([
      getStatusIcon(provider.available),
      getProviderColor(provider.name)(provider.name),
      formatDuration(provider.avgLatencyMs),
      provider.failoverCount.toString(),
      new Date(provider.lastChecked).toLocaleString(),
    ]);
  }

  console.log(table.toString());

  // Status cards
  console.log(chalk.cyan('\nProvider Details'));

  for (const provider of providers) {
    const status = provider.available
      ? chalk.green('✓ Online')
      : chalk.red('✕ Offline');

    console.log(
      `\n  ${getProviderColor(provider.name)(chalk.bold(provider.name.toUpperCase()))} ${status}`
    );
    console.log(`    Avg Latency: ${formatDuration(provider.avgLatencyMs)}`);
    console.log(`    Failovers: ${provider.failoverCount}`);
  }

  // Overall health insight
  if (providers.length > 0) {
    console.log('');
    if (availableCount === totalCount) {
      console.log(chalk.green('✓ All providers healthy'));
    } else if (availableCount === 0) {
      console.log(chalk.red('✕ All providers down!'));
    } else {
      const downProviders = providers
        .filter((p) => !p.available)
        .map((p) => p.name);
      console.log(
        chalk.yellow(
          `⚠ ${downProviders.length} provider(s) down: ${downProviders.join(', ')}`
        )
      );
    }
  }

  console.log('');
}

export async function healthCommand(serverUrl: string): Promise<void> {
  try {
    const { providers, timestamp } = await fetchHealth(serverUrl);
    displayHealth(providers, timestamp);
  } catch (error) {
    console.error(
      chalk.red('Error:'),
      error instanceof Error ? error.message : 'Failed to fetch health'
    );
    console.log(chalk.yellow('Make sure the dashboard server is running.'));
    process.exit(1);
  }
}
