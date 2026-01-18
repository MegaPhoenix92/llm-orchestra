/**
 * CLI command: stats
 * Display quick summary of Orchestra statistics
 */

import Table from 'cli-table3';
import chalk from 'chalk';
import type { DashboardStats } from '../../connectors/types.js';
import { fetchStats } from '../utils/api.js';

export { fetchStats };

export function displayStats(stats: DashboardStats): void {
  console.log(chalk.bold('\n🎼 LLM Orchestra Statistics\n'));

  // Summary
  console.log(chalk.cyan('Summary'));
  const summaryTable = new Table({
    head: ['Metric', 'Value'],
    colWidths: [25, 30],
  });

  summaryTable.push(
    ['Total Requests', chalk.green(stats.totalRequests.toString())],
    ['Total Input Tokens', stats.totalTokens.input.toLocaleString()],
    ['Total Output Tokens', stats.totalTokens.output.toLocaleString()],
    ['Total Cost', chalk.yellow(`$${stats.totalCost.toFixed(4)}`)]
  );

  console.log(summaryTable.toString());

  // By Provider
  if (Object.keys(stats.byProvider).length > 0) {
    console.log(chalk.cyan('\nBy Provider'));
    const providerTable = new Table({
      head: ['Provider', 'Requests', 'Tokens (In/Out)', 'Cost', 'Avg Latency'],
      colWidths: [15, 12, 20, 12, 15],
    });

    for (const [provider, data] of Object.entries(stats.byProvider)) {
      providerTable.push([
        chalk.bold(provider),
        data.requests.toString(),
        `${data.tokens.input.toLocaleString()}/${data.tokens.output.toLocaleString()}`,
        `$${data.cost.toFixed(4)}`,
        `${data.avgLatencyMs.toFixed(0)}ms`,
      ]);
    }

    console.log(providerTable.toString());
  }

  // By Model
  if (Object.keys(stats.byModel).length > 0) {
    console.log(chalk.cyan('\nBy Model'));
    const modelTable = new Table({
      head: ['Model', 'Requests', 'Tokens (In/Out)', 'Cost'],
      colWidths: [35, 12, 20, 12],
    });

    for (const [model, data] of Object.entries(stats.byModel)) {
      modelTable.push([
        model,
        data.requests.toString(),
        `${data.tokens.input.toLocaleString()}/${data.tokens.output.toLocaleString()}`,
        `$${data.cost.toFixed(4)}`,
      ]);
    }

    console.log(modelTable.toString());
  }

  console.log('');
}

export async function statsCommand(serverUrl: string): Promise<void> {
  try {
    const stats = await fetchStats(serverUrl);
    displayStats(stats);
  } catch (error) {
    console.error(
      chalk.red('Error:'),
      error instanceof Error ? error.message : 'Failed to fetch stats'
    );
    console.log(chalk.yellow('Make sure the dashboard server is running.'));
    process.exit(1);
  }
}
