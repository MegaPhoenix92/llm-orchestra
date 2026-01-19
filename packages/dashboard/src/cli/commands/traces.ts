/**
 * Traces Command
 * List recent traces from the dashboard
 */

import chalk from 'chalk';
import Table from 'cli-table3';

interface TraceInfo {
  id: string;
  name: string;
  durationMs?: number;
  status: 'ok' | 'error' | 'pending';
  startTime: number;
}

interface TracesResponse {
  traces: TraceInfo[];
}

export async function tracesCommand(serverUrl: string, limit: number): Promise<void> {
  try {
    const response = await fetch(serverUrl + '/api/traces?limit=' + limit);
    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ': ' + response.statusText);
    }

    const data = (await response.json()) as TracesResponse;
    const traces = data.traces || [];

    console.log('\n' + chalk.bold.cyan('Recent Traces') + '\n');

    if (traces.length === 0) {
      console.log(chalk.gray('No traces found.'));
      return;
    }

    const table = new Table({
      head: [
        chalk.bold('Trace ID'),
        chalk.bold('Name'),
        chalk.bold('Duration'),
        chalk.bold('Status'),
        chalk.bold('Time'),
      ],
      style: { head: [], border: [] },
    });

    for (const trace of traces) {
      const status = trace.status === 'ok' 
        ? chalk.green('ok') 
        : trace.status === 'error' 
          ? chalk.red('error')
          : chalk.yellow(trace.status);

      table.push([
        chalk.gray(trace.id.substring(0, 16)),
        trace.name,
        trace.durationMs ? trace.durationMs + 'ms' : '-',
        status,
        new Date(trace.startTime).toLocaleTimeString(),
      ]);
    }

    console.log(table.toString());
    console.log('');
  } catch (error) {
    console.error(chalk.red('Error fetching traces:'), (error as Error).message);
    console.log(chalk.gray('Make sure the dashboard server is running at ' + serverUrl));
    process.exit(1);
  }
}
