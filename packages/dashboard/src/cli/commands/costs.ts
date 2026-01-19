/**
 * Costs Command
 * Display cost breakdown from the dashboard
 */

import chalk from 'chalk';
import Table from 'cli-table3';

interface ProviderStats {
  requests: number;
  tokens: { input: number; output: number };
  cost: number;
  avgLatencyMs: number;
}

interface ModelStats {
  requests: number;
  tokens: { input: number; output: number };
  cost: number;
}

interface CostsResponse {
  totalCost: number;
  byProvider: Partial<Record<string, ProviderStats>>;
  byModel: Partial<Record<string, ModelStats>>;
}

export async function costsCommand(serverUrl: string): Promise<void> {
  try {
    const response = await fetch(serverUrl + '/api/stats');
    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ': ' + response.statusText);
    }

    const stats = (await response.json()) as CostsResponse;

    console.log('\n' + chalk.bold.cyan('Cost Breakdown') + '\n');
    console.log(chalk.bold('Total Cost: ') + chalk.magenta('$' + stats.totalCost.toFixed(4)));
    console.log('');

    // By Provider
    if (Object.keys(stats.byProvider).length > 0) {
      console.log(chalk.bold('By Provider:'));
      const providerTable = new Table({
        head: [
          chalk.bold('Provider'),
          chalk.bold('Requests'),
          chalk.bold('Input'),
          chalk.bold('Output'),
          chalk.bold('Cost'),
          chalk.bold('Avg Latency'),
        ],
        style: { head: [], border: [] },
      });

      for (const [name, data] of Object.entries(stats.byProvider)) {
        if (!data) continue;
        providerTable.push([
          chalk.cyan(name),
          data.requests.toLocaleString(),
          data.tokens.input.toLocaleString(),
          data.tokens.output.toLocaleString(),
          chalk.green('$' + data.cost.toFixed(4)),
          data.avgLatencyMs.toFixed(0) + 'ms',
        ]);
      }
      console.log(providerTable.toString());
      console.log('');
    }

    // By Model
    if (Object.keys(stats.byModel).length > 0) {
      console.log(chalk.bold('By Model:'));
      const modelTable = new Table({
        head: [
          chalk.bold('Model'),
          chalk.bold('Requests'),
          chalk.bold('Input'),
          chalk.bold('Output'),
          chalk.bold('Cost'),
        ],
        style: { head: [], border: [] },
      });

      for (const [name, data] of Object.entries(stats.byModel)) {
        if (!data) continue;
        modelTable.push([
          chalk.gray(name),
          data.requests.toLocaleString(),
          data.tokens.input.toLocaleString(),
          data.tokens.output.toLocaleString(),
          chalk.green('$' + data.cost.toFixed(4)),
        ]);
      }
      console.log(modelTable.toString());
    }

    console.log('');
  } catch (error) {
    console.error(chalk.red('Error fetching costs:'), (error as Error).message);
    console.log(chalk.gray('Make sure the dashboard server is running at ' + serverUrl));
    process.exit(1);
  }
}
