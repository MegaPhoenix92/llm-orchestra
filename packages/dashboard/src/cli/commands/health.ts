/**
 * Health Command
 * Display provider health status
 */

import chalk from 'chalk';
import Table from 'cli-table3';

interface ProviderHealth {
  name: string;
  available: boolean;
  avgLatencyMs?: number;
  lastChecked: number;
}

interface HealthResponse {
  providers: ProviderHealth[];
}

export async function healthCommand(serverUrl: string): Promise<void> {
  try {
    const response = await fetch(serverUrl + '/api/health');
    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ': ' + response.statusText);
    }

    const data = (await response.json()) as HealthResponse;
    const providers = data.providers || [];

    console.log('\n' + chalk.bold.cyan('Provider Health') + '\n');

    if (providers.length === 0) {
      console.log(chalk.gray('No providers configured.'));
      return;
    }

    const table = new Table({
      head: [
        chalk.bold('Provider'),
        chalk.bold('Status'),
        chalk.bold('Avg Latency'),
        chalk.bold('Last Checked'),
      ],
      style: { head: [], border: [] },
    });

    for (const provider of providers) {
      const status = provider.available
        ? chalk.green('Available')
        : chalk.red('Unavailable');

      table.push([
        chalk.cyan(provider.name),
        status,
        provider.avgLatencyMs ? provider.avgLatencyMs.toFixed(0) + 'ms' : '-',
        new Date(provider.lastChecked).toLocaleTimeString(),
      ]);
    }

    console.log(table.toString());
    console.log('');
  } catch (error) {
    console.error(chalk.red('Error fetching health:'), (error as Error).message);
    console.log(chalk.gray('Make sure the dashboard server is running at ' + serverUrl));
    process.exit(1);
  }
}
