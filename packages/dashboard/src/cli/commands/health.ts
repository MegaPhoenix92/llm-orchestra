/**
 * Health Command
 * Display provider health status
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { apiFetch, handleApiError, type ApiOptions } from '../api.js';

interface ProviderHealth {
  name: string;
  available: boolean;
  avgLatencyMs?: number;
  lastChecked: number;
}

interface HealthResponse {
  providers: ProviderHealth[];
}

export async function healthCommand(options: ApiOptions): Promise<void> {
  try {
    const data = await apiFetch<HealthResponse>(options, '/api/health', {
      projectId: options.projectId,
    });
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
      const status = provider.available ? chalk.green('Available') : chalk.red('Unavailable');

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
    handleApiError(error, options.server);
  }
}
