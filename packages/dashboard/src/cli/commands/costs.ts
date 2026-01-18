/**
 * CLI command: costs
 * Display cost breakdown
 */

import Table from 'cli-table3';
import chalk from 'chalk';
import type { DashboardStats } from '../../connectors/types.js';
import { fetchStats } from '../utils/api.js';

export function displayCosts(stats: DashboardStats): void {
  console.log(chalk.bold('\n💰 LLM Orchestra Cost Analysis\n'));

  const totalTokens = stats.totalTokens.input + stats.totalTokens.output;
  const costPerRequest =
    stats.totalRequests > 0 ? stats.totalCost / stats.totalRequests : 0;
  const costPer1kTokens =
    totalTokens > 0 ? (stats.totalCost / totalTokens) * 1000 : 0;

  // Summary
  console.log(chalk.cyan('Cost Summary'));
  const summaryTable = new Table({
    head: ['Metric', 'Value'],
    colWidths: [25, 30],
  });

  summaryTable.push(
    ['Total Cost', chalk.yellow(`$${stats.totalCost.toFixed(4)}`)],
    ['Cost per Request', `$${costPerRequest.toFixed(6)}`],
    ['Cost per 1K Tokens', `$${costPer1kTokens.toFixed(6)}`],
    ['Total Tokens', totalTokens.toLocaleString()]
  );

  console.log(summaryTable.toString());

  // Cost by Provider
  if (Object.keys(stats.byProvider).length > 0) {
    console.log(chalk.cyan('\nCost by Provider'));
    const providerTable = new Table({
      head: ['Provider', 'Requests', 'Cost', '% of Total', 'Avg/Request'],
      colWidths: [15, 12, 15, 15, 15],
    });

    const providers = Object.entries(stats.byProvider)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.cost - a.cost);

    for (const p of providers) {
      const pct =
        stats.totalCost > 0
          ? ((p.cost / stats.totalCost) * 100).toFixed(1)
          : '0.0';
      const avgPerRequest = p.requests > 0 ? p.cost / p.requests : 0;

      providerTable.push([
        chalk.bold(p.name),
        p.requests.toString(),
        `$${p.cost.toFixed(4)}`,
        `${pct}%`,
        `$${avgPerRequest.toFixed(6)}`,
      ]);
    }

    console.log(providerTable.toString());
  }

  // Cost by Model
  if (Object.keys(stats.byModel).length > 0) {
    console.log(chalk.cyan('\nCost by Model'));
    const modelTable = new Table({
      head: ['Model', 'Requests', 'Tokens', 'Cost', '% of Total'],
      colWidths: [35, 12, 20, 15, 12],
    });

    const models = Object.entries(stats.byModel)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.cost - a.cost);

    for (const m of models) {
      const totalModelTokens = m.tokens.input + m.tokens.output;
      const pct =
        stats.totalCost > 0
          ? ((m.cost / stats.totalCost) * 100).toFixed(1)
          : '0.0';

      modelTable.push([
        m.name,
        m.requests.toString(),
        totalModelTokens.toLocaleString(),
        `$${m.cost.toFixed(4)}`,
        `${pct}%`,
      ]);
    }

    console.log(modelTable.toString());

    // Top spending insight
    if (models.length > 0) {
      const topModel = models[0];
      console.log(
        chalk.gray(
          `\n💡 Highest cost: ${topModel.name} at $${topModel.cost.toFixed(4)} ` +
            `(${((topModel.cost / Math.max(stats.totalCost, 0.0001)) * 100).toFixed(0)}% of total)`
        )
      );
    }
  }

  // Budget projection (simple daily estimate)
  if (stats.totalRequests > 0 && stats.totalCost > 0) {
    console.log(chalk.cyan('\nCost Projections'));
    console.log(
      chalk.gray(
        `  At current rate (${stats.totalRequests} requests), daily cost estimate:`
      )
    );
    console.log(
      `  • 100 requests/day: ${chalk.yellow(`$${(costPerRequest * 100).toFixed(2)}/day`)}`
    );
    console.log(
      `  • 1,000 requests/day: ${chalk.yellow(`$${(costPerRequest * 1000).toFixed(2)}/day`)}`
    );
    console.log(
      `  • 10,000 requests/day: ${chalk.yellow(`$${(costPerRequest * 10000).toFixed(2)}/day`)}`
    );
  }

  console.log('');
}

export async function costsCommand(serverUrl: string): Promise<void> {
  try {
    const stats = await fetchStats(serverUrl);
    displayCosts(stats);
  } catch (error) {
    console.error(
      chalk.red('Error:'),
      error instanceof Error ? error.message : 'Failed to fetch costs'
    );
    console.log(chalk.yellow('Make sure the dashboard server is running.'));
    process.exit(1);
  }
}
